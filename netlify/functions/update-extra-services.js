// Admin-only management endpoint for optional future services.
// GET  -> returns all configured extra services.
// POST -> validates and replaces the extra-service configuration in Cloudinary.

const crypto = require('crypto');
const { sanitizeDescriptionHtml, plainTextToHtml } = require('./extra-service-richtext');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const EXTRA_SERVICES_PUBLIC_ID = process.env.CLOUDINARY_EXTRA_SERVICES_PUBLIC_ID || 'settings/extra-services-config.json';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
    body: JSON.stringify(body)
  };
}
function b64urlDecode(str){
  const s = String(str || '').replace(/-/g,'+').replace(/_/g,'/');
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s + pad, 'base64').toString('utf8');
}
function signRaw(data, secret){ return crypto.createHmac('sha256', secret).update(data).digest('hex'); }
function verifyAdminToken(token){
  if(!token || !ADMIN_JWT_SECRET) return null;
  const [data, sig] = String(token).split('.');
  if(!data || !sig) return null;
  const expect = signRaw(data, ADMIN_JWT_SECRET);
  if(expect !== sig) return null;
  try {
    const payload = JSON.parse(b64urlDecode(data));
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch(e) { return null; }
}
function getToken(event){
  return event.headers['x-admin-token'] || event.headers['X-Admin-Token'] || event.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
}
function basicAuthHeader(key, secret) { return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`; }
function cloudinarySignature(params) {
  const base = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + API_SECRET;
  return crypto.createHash('sha1').update(base).digest('hex');
}
function cleanText(value, max){ return String(value == null ? '' : value).trim().slice(0, max); }
function makeId(name, index){
  const latin = cleanText(name, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
  return (latin || `extra-service-${Date.now()}-${index + 1}`).slice(0, 80);
}
function normalizeServices(input) {
  if (!Array.isArray(input)) throw new Error('services 必須是陣列');
  if (input.length > 100) throw new Error('額外服務最多 100 項');
  const ids = new Set();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 項服務格式錯誤`);
    const name = cleanText(raw.name, 80);
    if (!name) throw new Error(`第 ${index + 1} 項服務缺少名稱`);
    const category = ['ac_addon', 'other_service'].includes(raw.category) ? raw.category : '';
    if (!category) throw new Error(`${name} 的服務類型不正確`);
    const pricingType = ['fixed', 'starting', 'quote'].includes(raw.pricing_type) ? raw.pricing_type : 'quote';
    let price = 0;
    if (pricingType !== 'quote') {
      const n = Number(raw.price);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error(`${name} 的價格必須是 0 以上整數`);
      price = Math.round(n);
    }
    let id = cleanText(raw.id, 80) || makeId(name, index);
    id = id.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `extra-service-${Date.now()}-${index + 1}`;
    if (ids.has(id)) throw new Error(`服務 ID 重複：${id}`);
    ids.add(id);
    const quantityLimitType = ['fixed','ac_count','unlimited'].includes(raw.quantity_limit_type) ? raw.quantity_limit_type : 'fixed';
    const maxQuantityRaw = Number(raw.max_quantity);
    const maxQuantity = Number.isFinite(maxQuantityRaw) && maxQuantityRaw >= 1 ? Math.min(99, Math.round(maxQuantityRaw)) : 20;
    const richDescription = sanitizeDescriptionHtml(raw.description_html || plainTextToHtml(raw.description || ''));
    return {
      id,
      name,
      category,
      description: richDescription.text,
      description_html: richDescription.html,
      unit: cleanText(raw.unit, 12) || '項',
      pricing_type: pricingType,
      price,
      enabled: raw.enabled !== false,
      sort_order: Number.isFinite(Number(raw.sort_order)) ? Math.round(Number(raw.sort_order)) : index * 10,
      quantity_limit_type: quantityLimitType,
      max_quantity: maxQuantity,
      updated_at: new Date().toISOString()
    };
  }).sort((a,b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'zh-Hant'));
}
async function findAsset() {
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(API_KEY, API_SECRET) },
    body: JSON.stringify({ expression: `resource_type:raw AND public_id="${EXTRA_SERVICES_PUBLIC_ID}"`, max_results: 1 })
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({}));
  return data?.resources?.[0] || null;
}
async function loadDocument() {
  const asset = await findAsset();
  if (!asset?.secure_url) return { services: [], source: 'default', updated_at: null, updated_by: null };
  const url = asset.secure_url + (asset.secure_url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!resp.ok) return { services: [], source: 'default', updated_at: null, updated_by: null };
  const doc = await resp.json().catch(() => ({}));
  let services = [];
  try { services = normalizeServices(Array.isArray(doc.services) ? doc.services : []); } catch(e) { services = []; }
  return {
    services,
    source: 'cloudinary',
    updated_at: doc.updated_at || asset.updated_at || asset.created_at || null,
    updated_by: doc.updated_by || null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  const admin = verifyAdminToken(getToken(event));
  if (!admin) return json(401, { error: 'Unauthorized' });
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return json(500, { error: 'Cloudinary env not configured' });

  if (event.httpMethod === 'GET') {
    try { return json(200, await loadDocument()); }
    catch (err) { return json(500, { error: err && err.message ? err.message : String(err) }); }
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) { return json(400, { error: 'Invalid JSON' }); }
  let services;
  try { services = normalizeServices(body.services || []); } catch(e) { return json(400, { error: e.message }); }

  try {
    const nowIso = new Date().toISOString();
    const payload = {
      services,
      updated_at: nowIso,
      updated_by: admin.u || 'admin',
      version: 3
    };
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { overwrite: 'true', public_id: EXTRA_SERVICES_PUBLIC_ID, timestamp };
    const signature = cloudinarySignature(params);
    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'extra-services-config.json');
    form.append('api_key', API_KEY);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    form.append('public_id', EXTRA_SERVICES_PUBLIC_ID);
    form.append('overwrite', 'true');

    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, { method: 'POST', body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return json(resp.status || 500, { error: data.error?.message || 'Cloudinary upload failed', detail: data });
    return json(200, { ok: true, services, updated_at: nowIso, updated_by: admin.u || 'admin', public_id: data.public_id || EXTRA_SERVICES_PUBLIC_ID });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : String(err) });
  }
};

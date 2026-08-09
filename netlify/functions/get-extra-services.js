// Public endpoint for optional future services configured from the admin panel.
// Existing built-in services do not depend on this file. When no extra services
// are configured, the front-end behaves exactly as before.

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const { sanitizeDescriptionHtml, plainTextToHtml } = require('./extra-service-richtext');

const EXTRA_SERVICES_PUBLIC_ID = process.env.CLOUDINARY_EXTRA_SERVICES_PUBLIC_ID || 'settings/extra-services-config.json';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    },
    body: JSON.stringify(body)
  };
}

function basicAuthHeader(key, secret) {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

function normalizeService(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().slice(0, 80);
  const name = String(raw.name || '').trim().slice(0, 80);
  const category = ['ac_addon', 'other_service'].includes(raw.category) ? raw.category : '';
  const pricingType = ['fixed', 'starting', 'quote'].includes(raw.pricing_type) ? raw.pricing_type : 'quote';
  const priceNumber = Number(raw.price);
  const price = pricingType === 'quote' ? 0 : (Number.isFinite(priceNumber) && priceNumber >= 0 ? Math.round(priceNumber) : 0);
  const unit = String(raw.unit || '項').trim().slice(0, 12) || '項';
  const richDescription = sanitizeDescriptionHtml(raw.description_html || plainTextToHtml(raw.description || ''));
  const description = richDescription.text;
  const descriptionHtml = richDescription.html;
  const sortOrder = Number.isFinite(Number(raw.sort_order)) ? Math.round(Number(raw.sort_order)) : 0;
  const quantityLimitType = ['fixed','ac_count','unlimited'].includes(raw.quantity_limit_type) ? raw.quantity_limit_type : 'fixed';
  const maxQuantityRaw = Number(raw.max_quantity);
  const maxQuantity = Number.isFinite(maxQuantityRaw) && maxQuantityRaw >= 1 ? Math.min(99, Math.round(maxQuantityRaw)) : 20;
  if (!id || !name || !category) return null;
  return {
    id,
    name,
    category,
    description,
    description_html: descriptionHtml,
    unit,
    pricing_type: pricingType,
    price,
    enabled: raw.enabled !== false,
    sort_order: sortOrder,
    quantity_limit_type: quantityLimitType,
    max_quantity: maxQuantity
  };
}

function normalizeServices(input) {
  const list = Array.isArray(input) ? input : [];
  return list.map(normalizeService).filter(Boolean).sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'zh-Hant'));
}

async function findAsset() {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return null;
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(API_KEY, API_SECRET) },
    body: JSON.stringify({ expression: `resource_type:raw AND public_id="${EXTRA_SERVICES_PUBLIC_ID}"`, max_results: 1 })
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({}));
  return data?.resources?.[0] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  try {
    const asset = await findAsset();
    if (!asset?.secure_url) return json(200, { services: [], source: 'default', updated_at: null });
    const url = asset.secure_url + (asset.secure_url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!resp.ok) return json(200, { services: [], source: 'default', updated_at: null, warning: 'extra services asset fetch failed' });
    const doc = await resp.json().catch(() => ({}));
    const services = normalizeServices(doc.services || []).filter(service => service.enabled);
    return json(200, { services, source: 'cloudinary', updated_at: doc.updated_at || asset.updated_at || asset.created_at || null });
  } catch (err) {
    return json(200, { services: [], source: 'default', updated_at: null, warning: err && err.message ? err.message : String(err) });
  }
};

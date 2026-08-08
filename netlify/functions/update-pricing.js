// netlify/functions/update-pricing.js
// Admin-only pricing settings endpoint.
// GET  -> returns current prices + recent change history.
// POST -> validates, records a diff/history entry, and overwrites Cloudinary raw JSON.

const crypto = require('crypto');
const { loadNotificationSettings, canSendBrevoEmail, sendBrevoNotification, buildSimpleAdminEmail } = require('./notification-utils');

const DEFAULT_PRICES = {
  acSplit: 1800,
  acSplitBulk: 1500,
  acCeiling: 2800,
  acTransformer: 500,
  acSpecialExtraMin: 300,
  antiMold: 300,
  antiMoldBulk: 250,
  ozone: 200,
  washer: 2000,
  washerWithAc: 1800,
  tank: 1000,
  tankWithPipe: 800,
  pipeBaseNoKitchenOneBath: 3200,
  pipeBaseOneKitchenOneBath: 4200,
  pipeExtraBathOrKitchen: 500
};

const PRICE_LABELS = {
  acSplit: '分離式冷氣清洗',
  acSplitBulk: '分離式冷氣三台以上優惠',
  acCeiling: '吊隱式冷氣清洗',
  acTransformer: '變形金剛系列加價',
  acSpecialExtraMin: '特殊機型加價起價',
  antiMold: '冷氣防霉抗菌處理',
  antiMoldBulk: '防霉滿五台優惠',
  ozone: '臭氧空間消毒',
  washer: '直立式洗衣機清洗',
  washerWithAc: '洗衣機搭配冷氣優惠',
  tank: '家用水塔清洗',
  tankWithPipe: '水塔搭配水管優惠',
  pipeBaseNoKitchenOneBath: '水管清洗｜無廚一衛',
  pipeBaseOneKitchenOneBath: '水管清洗｜一廚一衛',
  pipeExtraBathOrKitchen: '水管清洗｜加一衛/廚'
};

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const PRICING_PUBLIC_ID = process.env.CLOUDINARY_PRICING_PUBLIC_ID || 'settings/pricing-config.json';
const MAX_HISTORY = 30;

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
function signRaw(data, secret){
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
function verifyAdminToken(token){
  if(!token || !ADMIN_JWT_SECRET) return null;
  const [data, sig] = String(token).split('.');
  if(!data || !sig) return null;
  const expect = signRaw(data, ADMIN_JWT_SECRET);
  if(expect !== sig) return null;
  try {
    const payload = JSON.parse(b64urlDecode(data));
    const now = Math.floor(Date.now()/1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch(e) { return null; }
}
function getToken(event){
  return event.headers['x-admin-token'] || event.headers['X-Admin-Token'] || event.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
}
function normalizePrices(input) {
  if (!input || typeof input !== 'object') throw new Error('缺少 prices 物件');
  const out = {};
  for (const key of Object.keys(DEFAULT_PRICES)) {
    const source = input[key] == null ? DEFAULT_PRICES[key] : input[key];
    const n = Number(source);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${PRICE_LABELS[key] || key} 必須是 0 以上的數字`);
    out[key] = Math.round(n);
  }
  return out;
}
function normalizeExistingPrices(input) {
  const out = { ...DEFAULT_PRICES };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULT_PRICES)) {
    const n = Number(input[key]);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return out;
}
function cloudinarySignature(params) {
  const base = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + API_SECRET;
  return crypto.createHash('sha1').update(base).digest('hex');
}
function basicAuthHeader(key, secret) {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}
async function findPricingAsset() {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return null;
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(API_KEY, API_SECRET) },
    body: JSON.stringify({ expression: `resource_type:raw AND public_id="${PRICING_PUBLIC_ID}"`, max_results: 1 })
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({}));
  return data?.resources?.[0] || null;
}
async function loadPricingDocument() {
  const asset = await findPricingAsset();
  if (!asset?.secure_url) {
    return { prices: { ...DEFAULT_PRICES }, updated_at: null, history: [], source: 'default' };
  }
  const url = asset.secure_url + (asset.secure_url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!resp.ok) {
    return { prices: { ...DEFAULT_PRICES }, updated_at: asset.updated_at || asset.created_at || null, history: [], source: 'default' };
  }
  const doc = await resp.json().catch(() => ({}));
  return {
    prices: normalizeExistingPrices(doc.prices || doc),
    updated_at: doc.updated_at || asset.updated_at || asset.created_at || null,
    updated_by: doc.updated_by || null,
    change_note: doc.change_note || '',
    history: Array.isArray(doc.history) ? doc.history.slice(0, MAX_HISTORY) : [],
    source: 'cloudinary'
  };
}
function buildChanges(before, after) {
  return Object.keys(DEFAULT_PRICES).filter(key => Number(before[key]) !== Number(after[key])).map(key => ({
    key,
    label: PRICE_LABELS[key] || key,
    from: Number(before[key]),
    to: Number(after[key])
  }));
}
function getWarnings(prices) {
  const warnings = [];
  if (prices.acSplitBulk > prices.acSplit) warnings.push('分離式冷氣三台以上優惠價高於一般價');
  if (prices.antiMoldBulk > prices.antiMold) warnings.push('防霉五台以上優惠價高於一般價');
  if (prices.washerWithAc > prices.washer) warnings.push('洗衣機搭配冷氣優惠價高於單獨預約價');
  if (prices.tankWithPipe > prices.tank) warnings.push('水塔搭配水管優惠價高於單獨預約價');
  if (prices.acSpecialExtraMin > prices.acTransformer) warnings.push('特殊機型加價起價高於變形金剛系列加價');
  return warnings;
}
async function notifyPricingChanged(prices, updatedAt, changes, note) {
  try {
    const settings = await loadNotificationSettings();
    const gate = canSendBrevoEmail(settings, 'pricingChangeEmailEnabled');
    if (!gate.ok) return { status: 'skipped', error: gate.reason };
    const rows = [
      ['事件', '價格設定變更'],
      ['變更時間', updatedAt],
      ['變更備註', note || '未填寫'],
      ['異動項目數', String(changes.length)]
    ];
    for (const change of changes.slice(0, 20)) {
      rows.push([change.label, `${change.from} → ${change.to}`]);
    }
    return await sendBrevoNotification({
      subject: `${process.env.EMAIL_SUBJECT_PREFIX || ''}後台價格設定已變更`,
      html: buildSimpleAdminEmail('後台價格設定已變更', rows),
      tags: ['reservation-admin', 'pricing-change']
    });
  } catch (err) {
    return { status: 'failed', error: err && err.message ? err.message : String(err) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  const admin = verifyAdminToken(getToken(event));
  if (!admin) return json(401, { error: 'Unauthorized' });
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return json(500, { error: 'Cloudinary env not configured' });

  if (event.httpMethod === 'GET') {
    try {
      const current = await loadPricingDocument();
      return json(200, current);
    } catch (err) {
      return json(500, { error: err && err.message ? err.message : String(err) });
    }
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) { return json(400, { error: 'Invalid JSON' }); }
  let prices;
  try { prices = normalizePrices(body.prices || body); } catch(e) { return json(400, { error: e.message }); }

  try {
    const current = await loadPricingDocument();
    const changes = buildChanges(current.prices, prices);
    const warnings = getWarnings(prices);
    if (!changes.length) {
      return json(200, {
        ok: true,
        unchanged: true,
        prices: current.prices,
        updated_at: current.updated_at,
        history: current.history,
        warnings
      });
    }

    const nowIso = new Date().toISOString();
    const note = String(body.change_note || body.note || '').trim().slice(0, 500);
    const historyEntry = {
      updated_at: nowIso,
      updated_by: admin.u || 'admin',
      note,
      changes
    };
    const history = [historyEntry, ...(current.history || [])].slice(0, MAX_HISTORY);
    const payload = {
      prices,
      updated_at: nowIso,
      updated_by: admin.u || 'admin',
      change_note: note,
      history,
      version: 2
    };

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { overwrite: 'true', public_id: PRICING_PUBLIC_ID, timestamp };
    const signature = cloudinarySignature(params);
    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'pricing-config.json');
    form.append('api_key', API_KEY);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    form.append('public_id', PRICING_PUBLIC_ID);
    form.append('overwrite', 'true');

    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, { method: 'POST', body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return json(resp.status || 500, { error: data.error?.message || 'Cloudinary upload failed', detail: data });

    const notification = await notifyPricingChanged(prices, nowIso, changes, note);
    return json(200, {
      ok: true,
      prices,
      updated_at: nowIso,
      updated_by: admin.u || 'admin',
      change_note: note,
      changes,
      history,
      warnings,
      public_id: data.public_id || PRICING_PUBLIC_ID,
      notification
    });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : String(err) });
  }
};

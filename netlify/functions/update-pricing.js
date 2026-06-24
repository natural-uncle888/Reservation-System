// netlify/functions/update-pricing.js
// Admin-only endpoint for updating pricing settings stored as a Cloudinary raw JSON asset.

const crypto = require('crypto');
const { loadNotificationSettings, canSendBrevoEmail, sendBrevoNotification, buildSimpleAdminEmail } = require('./notification-utils');

const DEFAULT_PRICES = {
  acSplit: 1800,
  acSplitBulk: 1500,
  acCeiling: 2800,
  acTransformer: 500,
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

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const PRICING_PUBLIC_ID = process.env.CLOUDINARY_PRICING_PUBLIC_ID || 'settings/pricing-config.json';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
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
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a number >= 0`);
    out[key] = Math.round(n);
  }
  return out;
}
function cloudinarySignature(params) {
  const base = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + API_SECRET;
  return crypto.createHash('sha1').update(base).digest('hex');
}

async function notifyPricingChanged(prices, updatedAt) {
  try {
    const settings = await loadNotificationSettings();
    const gate = canSendBrevoEmail(settings, 'pricingChangeEmailEnabled');
    if (!gate.ok) return { status: 'skipped', error: gate.reason };
    const rows = [
      ['事件', '價格設定變更'],
      ['變更時間', updatedAt],
      ['冷氣分離式', prices.acSplit],
      ['冷氣分離式 3 台以上', prices.acSplitBulk],
      ['冷氣吊隱式', prices.acCeiling],
      ['變形金剛加價', prices.acTransformer],
      ['防霉抗菌', prices.antiMold],
      ['臭氧消毒', prices.ozone],
      ['洗衣機', prices.washer],
      ['水塔', prices.tank],
      ['水管無廚一衛', prices.pipeBaseNoKitchenOneBath],
      ['水管一廚一衛', prices.pipeBaseOneKitchenOneBath]
    ];
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
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!verifyAdminToken(getToken(event))) return json(401, { error: 'Unauthorized' });
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return json(500, { error: 'Cloudinary env not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) { return json(400, { error: 'Invalid JSON' }); }
  let prices;
  try { prices = normalizePrices(body.prices || body); } catch(e) { return json(400, { error: e.message }); }

  const nowIso = new Date().toISOString();
  const payload = { prices, updated_at: nowIso, version: 1 };
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

  try {
    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, { method: 'POST', body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return json(resp.status || 500, { error: data.error?.message || 'Cloudinary upload failed', detail: data });
    const notification = await notifyPricingChanged(prices, nowIso);
    return json(200, { ok: true, prices, updated_at: nowIso, public_id: data.public_id || PRICING_PUBLIC_ID, notification });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : String(err) });
  }
};

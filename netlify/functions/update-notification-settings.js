// netlify/functions/update-notification-settings.js
// Admin-only endpoint for updating notification toggles stored as a Cloudinary raw JSON asset.

const crypto = require('crypto');
const {
  NOTIFICATION_PUBLIC_ID,
  normalizeNotificationSettings
} = require('./notification-utils');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

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
function cloudinarySignature(params) {
  const base = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + API_SECRET;
  return crypto.createHash('sha1').update(base).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!verifyAdminToken(getToken(event))) return json(401, { error: 'Unauthorized' });
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return json(500, { error: 'Cloudinary env not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) { return json(400, { error: 'Invalid JSON' }); }
  let settings;
  try { settings = normalizeNotificationSettings(body.settings || body.notifications || body); } catch(e) { return json(400, { error: e.message }); }

  const nowIso = new Date().toISOString();
  const payload = { notifications: settings, updated_at: nowIso, version: 2 };
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { overwrite: 'true', public_id: NOTIFICATION_PUBLIC_ID, timestamp };
  const signature = cloudinarySignature(params);

  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'notification-config.json');
  form.append('api_key', API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  form.append('public_id', NOTIFICATION_PUBLIC_ID);
  form.append('overwrite', 'true');

  try {
    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`, { method: 'POST', body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return json(resp.status || 500, { error: data.error?.message || 'Cloudinary upload failed', detail: data });
    return json(200, { ok: true, settings, updated_at: nowIso, public_id: data.public_id || NOTIFICATION_PUBLIC_ID });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : String(err) });
  }
};

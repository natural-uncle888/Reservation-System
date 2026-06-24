// netlify/functions/get-notification-settings.js
// Admin endpoint used by 後台管理 > 通知設定.
// Reads notification toggle JSON from Cloudinary raw asset; falls back to safe defaults.

const crypto = require('crypto');
const {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  findNotificationAsset
} = require('./notification-utils');

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }
  if (!verifyAdminToken(getToken(event))) return json(401, { error: 'Unauthorized' });

  try {
    const asset = await findNotificationAsset();
    if (!asset || !asset.secure_url) {
      return json(200, { settings: DEFAULT_NOTIFICATION_SETTINGS, source: 'default' });
    }
    const url = asset.secure_url + (asset.secure_url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!resp.ok) return json(200, { settings: DEFAULT_NOTIFICATION_SETTINGS, source: 'default', warning: 'notification asset fetch failed' });
    const doc = await resp.json();
    const settings = normalizeNotificationSettings(doc.notifications || doc.settings || doc);
    return json(200, { settings, source: 'cloudinary', updated_at: doc.updated_at || asset.updated_at || asset.created_at || null });
  } catch (err) {
    return json(200, { settings: DEFAULT_NOTIFICATION_SETTINGS, source: 'default', warning: err && err.message ? err.message : String(err) });
  }
};

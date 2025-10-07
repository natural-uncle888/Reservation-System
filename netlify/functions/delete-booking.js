// netlify/functions/delete-booking.js
const { v2: cloudinary } = require('cloudinary');
const crypto = require('crypto');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY    = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const SECRET     = process.env.ADMIN_JWT_SECRET;

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
});

function verify(token) {
  if (!token || !SECRET) return false;
  const [data, sig] = String(token).split('.');
  if (!data || !sig) return false;
  const expect = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  if (expect !== sig) return false;
  try {
    const json = JSON.parse(Buffer.from(
      data.replace(/-/g, '+').replace(/_/g, '/') + '===',
      'base64'
    ).toString('utf8'));
    if (!json.exp || json.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function sanitizePublicId(input) {
  const decoded = decodeURIComponent(String(input || ''));
  // 去掉常見副檔名（.pdf/.jpg/.png/.webp/.gif/.heic/.mp4/.mov/.mkv 等）
  return decoded.replace(/\.(pdf|jpg|jpeg|png|webp|gif|heic|mp4|mov|avi|mkv)$/i, '');
}

exports.handler = async function (event) {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return resp(500, { error: 'Cloudinary credentials not configured' });
  }

  if (event.httpMethod !== 'DELETE') {
    return resp(405, { error: 'Method Not Allowed' });
  }

  const tokenHeader =
    event.headers['x-admin-token'] ||
    event.headers['X-Admin-Token'] ||
    event.headers['x-Admin-Token'];

  if (!verify(tokenHeader)) {
    return resp(401, { error: 'Unauthorized' });
  }

  const qs = event.queryStringParameters || {};
  const rawPublicId = qs.public_id;
  const hintResourceType = qs.resource_type; // 若前端有帶，優先使用
  if (!rawPublicId) return resp(400, { error: 'Missing public_id' });

  const pidWithExt = decodeURIComponent(rawPublicId);
  const pid = sanitizePublicId(rawPublicId);

  // 嘗試順序：若指定 resource_type 則只試那個，否則依序 raw → image → video
  const tryTypes = hintResourceType ? [hintResourceType] : ['raw', 'image', 'video'];

  // 也嘗試兩種 id：原始（可能含副檔名）與去副檔名後
  const tryIds = Array.from(new Set([pidWithExt, pid]));

  for (const id of tryIds) {
    for (const rt of tryTypes) {
      try {
        const r = await cloudinary.uploader.destroy(id, {
          resource_type: rt,
          type: 'upload',
          invalidate: true,
        });
        // r.result 可能是 'ok'、'not found'、'error'
        if (r?.result === 'ok') {
          return resp(200, { ok: true, deleted_id: id, resource_type: rt, result: r });
        }
      } catch (e) {
        // 換下一個 resource_type / id 繼續嘗試
      }
    }
  }

  return resp(404, {
    error: 'Cloudinary 無法刪除：可能 public_id 錯誤或不存在',
    attempted_ids: tryIds,
    attempted_resource_types: tryTypes,
  });
};

function resp(statusCode, body) {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

// netlify/functions/update-booking-context.js
const crypto = require("crypto");

function verify(token, secret){
  if(!token || !secret) return false;
  const [data, sig] = String(token).split(".");
  if(!data || !sig) return false;
  const expect = crypto.createHmac("sha256", secret).update(data).digest("hex");
  if (expect !== sig) return false;
  try {
    const json = JSON.parse(Buffer.from(data.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"));
    if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
    return true;
  } catch { return false; }
}

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

// 將 Cloudinary context string (key=value|key2=value2) 轉為物件
function parseContextString(ctxStr = "") {
  const obj = {};
  ctxStr.split("|").forEach(pair => {
    const [k, v] = pair.split("=");
    if (k && v != null) obj[k.trim()] = v.trim();
  });
  return obj;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Cloudinary env not configured" }) };
    }

    const tok = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
    if (!verify(tok, ADMIN_JWT_SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}

    const public_id = String(body.public_id || "").trim();
    const incomingCtx = body.context || {};
    const resource_type = (body.resource_type || "raw").trim();
    const type = (body.type || "upload").trim();

    if (!public_id || typeof incomingCtx !== "object") {
      return { statusCode: 400, body: JSON.stringify({ error: "public_id and context required" }) };
    }

    // ====== 先讀取原始 context ======
    const fetchUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${resource_type}/${type}/${encodeURIComponent(public_id)}`;
    const fetchResp = await fetch(fetchUrl, {
      headers: {
        "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET),
      }
    });

    let originalCtx = {};
    if (fetchResp.ok) {
      const asset = await fetchResp.json();
      const ctxStr = asset?.context?.custom || asset?.context;
      if (typeof ctxStr === "object") {
        originalCtx = ctxStr;
      } else if (typeof ctxStr === "string") {
        originalCtx = parseContextString(ctxStr);
      }
    }

    // ====== 合併新舊 context ======
    const mergedCtx = {
      ...originalCtx,
      ...incomingCtx
    };

    // ====== 準備 Cloudinary context 字串格式 ======
    const parts = [];
    for (const [k,v] of Object.entries(mergedCtx)) {
      if (v == null) continue;
      const val = String(v).replace(/\|/g,"/").trim();
      if (val) parts.push(`${k}=${val}`);
    }
    const context = parts.join("|");

    // ====== 發送更新請求 ======
    const updateUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${resource_type}/${type}/${encodeURIComponent(public_id)}`;
    const form = new URLSearchParams({ context });

    const updateResp = await fetch(updateUrl, {
      method: "POST",
      headers: {
        "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });

    const txt = await updateResp.text();
    if (!updateResp.ok) {
      return { statusCode: updateResp.status, body: JSON.stringify({ error: "update failed", detail: txt }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, result: JSON.parse(txt) }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e && e.message ? e.message : String(e) }) };
  }
};

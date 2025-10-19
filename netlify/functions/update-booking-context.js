// netlify/functions/update-booking-context.js
// 以管理者身分更新 Cloudinary 資產的 context（用於從信件內容貼上後回填）
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Cloudinary env not configured" }), headers: { "Content-Type":"application/json" } };
    }
    const tok = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
    if (!verify(tok, ADMIN_JWT_SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: { "Content-Type":"application/json" } };
    }
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const public_id = String(body.public_id || "").trim();
    const ctxObj = body.context || {};
    const resource_type = (body.resource_type || "raw").trim();
    const type = (body.type || "upload").trim();
    if (!public_id || typeof ctxObj !== "object") {
      return { statusCode: 400, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "public_id and context required" }) };
    }
    // Build Cloudinary context string: key=value|key2=value2
    const parts = [];
    for (const [k,v] of Object.entries(ctxObj)) {
      if (v == null) continue;
      const val = String(v).replace(/\|/g,"/").trim();
      if (val) parts.push(`${k}=${val}`);
    }
    const context = parts.join("|");
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${resource_type}/${type}/${encodeURIComponent(public_id)}`;
    const form = new URLSearchParams({ context });
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET), "Content-Type":"application/x-www-form-urlencoded" },
      body: form.toString()
    });
    const txt = await resp.text();
    if (!resp.ok) {
      return { statusCode: resp.status, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "update failed", detail: txt }) };
    }
    return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ ok: true, result: JSON.parse(txt) }) };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: e && e.message ? e.message : String(e) }) };
  }
};

// netlify/functions/signed-pdf.js
// 強韌版：為私有 PDF 產生短效簽名 URL
// 策略：
//  - 先以 item.type（或 upload）呼叫 private_download
//  - 若失敗，再依序嘗試 type=authenticated / private
//  - 最後才嘗試 download 端點
//  - 回傳詳細錯誤，方便定位
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

function signParams(obj, apiSecret){
  const filtered = Object.entries(obj)
    .filter(([k,v]) => v !== undefined && v !== null && v !== "" && k !== "file" && k !== "signature")
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const toSign = filtered.map(([k,v]) => `${k}=${v}`).join("&") + apiSecret;
  return crypto.createHash("sha1").update(toSign).digest("hex");
}

async function doPrivateDownload({ cloud, apiKey, apiSecret, public_id, format, resource_type, type }){
  const timestamp = Math.floor(Date.now()/1000);
  const params = { public_id, format, resource_type, type, timestamp, api_key: apiKey };
  const signature = signParams(params, apiSecret);
  const form = new URLSearchParams();
  for (const [k,v] of Object.entries(params)) form.append(k, String(v));
  form.append("signature", signature);
  const url = `https://api.cloudinary.com/v1_1/${cloud}/private_download`;
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type":"application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text, url, type };
}

async function doDownload({ cloud, apiKey, apiSecret, public_id, format, resource_type, type }){
  const timestamp = Math.floor(Date.now()/1000);
  const params = { public_id, format, resource_type, type, timestamp, api_key: apiKey };
  const signature = signParams(params, apiSecret);
  const form = new URLSearchParams();
  for (const [k,v] of Object.entries(params)) form.append(k, String(v));
  form.append("signature", signature);
  const url = `https://api.cloudinary.com/v1_1/${cloud}/download`;
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type":"application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text, url, type };
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
    let public_id = String(body.public_id || "").trim();
    let format = body.format ? String(body.format).trim() : "";
    const resource_type = (body.resource_type ? String(body.resource_type) : "raw").trim();
    let itemType = (body.type ? String(body.type) : "upload").trim();

    if (!public_id) {
      return { statusCode: 400, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "public_id required" }) };
    }
    // public_id 若含副檔名則拆開
    const m = public_id.match(/^(.*)\.([a-z0-9]+)$/i);
    if (m && !format) { public_id = m[1]; format = m[2]; }
    if (!format) format = "pdf";

    const ctx = { cloud: CLOUDINARY_CLOUD_NAME, apiKey: CLOUDINARY_API_KEY, apiSecret: CLOUDINARY_API_SECRET, public_id, format, resource_type };

    // 依序嘗試的 type
    const typesToTry = Array.from(new Set([itemType, "authenticated", "private", "upload"])).filter(Boolean);
    const attempts = [];
    for (const tp of typesToTry) {
      const a = await doPrivateDownload({ ...ctx, type: tp });
      attempts.push({ step: `private_download:${tp}`, status: a.status, body: a.text.slice(0,300) });
      if (a.ok) {
        try { const j = JSON.parse(a.text); if (j.url) return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: j.url }) }; } catch {}
        const m1 = a.text.match(/https?:\/\/\S+/); if (m1) return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: m1[0] }) };
      }
    }

    // 最後嘗試 download
    for (const tp of typesToTry) {
      const b = await doDownload({ ...ctx, type: tp });
      attempts.push({ step: `download:${tp}`, status: b.status, body: b.text.slice(0,300) });
      if (b.ok) {
        try { const j = JSON.parse(b.text); if (j.url) return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: j.url }) }; } catch {}
        const m2 = b.text.match(/https?:\/\/\S+/); if (m2) return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: m2[0] }) };
      }
    }

    return { statusCode: 502, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "signed url failed", params: { public_id, format, resource_type, typesTried: typesToTry }, attempts }) };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: e && e.message ? e.message : String(e) }) };
  }
};

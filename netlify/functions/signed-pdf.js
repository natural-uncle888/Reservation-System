// netlify/functions/signed-pdf.js
// 以 Cloudinary private_download 產生短效（一次性）簽名 URL，支援 raw/pdf 等私有資產
// 需要：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET
// 呼叫：POST { public_id, format?, resource_type?, type?, ttl? } + header x-admin-token
const crypto = require("crypto");

function verify(token, secret){
  if(!token || !secret) return false;
  const [data, sig] = String(token).split(".");
  if(!data || !sig) return false;
  const expect = require("crypto").createHmac("sha256", secret).update(data).digest("hex");
  if (expect !== sig) return false;
  try {
    const json = JSON.parse(Buffer.from(data.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"));
    if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
    return true;
  } catch { return false; }
}

// Cloudinary 簽名：將參數（排除 file 與 signature），按字母序串接 key=value&... + apiSecret 做 SHA1
function signParams(obj, apiSecret){
  const filtered = Object.entries(obj)
    .filter(([k,v]) => v !== undefined && v !== null && v !== "" && k !== "file" && k !== "signature")
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const toSign = filtered.map(([k,v]) => `${k}=${v}`).join("&") + apiSecret;
  return require("crypto").createHash("sha1").update(toSign).digest("hex");
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
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
    const type = (body.type ? String(body.type) : "upload").trim();
    const ttl = Math.min(parseInt(body.ttl || "900", 10), 3600); // <= 1h

    if (!public_id) {
      return { statusCode: 400, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "public_id required" }) };
    }

    // 若 public_id 帶副檔名（如 xxx.pdf），拆成 public_id + format
    const m = public_id.match(/^(.*)\.([a-z0-9]+)$/i);
    if (m && !format) {
      public_id = m[1];
      format = m[2];
    }
    if (!format) format = "pdf";

    // 參數：需要 timestamp
    const timestamp = Math.floor(Date.now()/1000) + ttl;
    const params = {
      public_id,
      format,
      resource_type,
      type,
      timestamp,
      api_key: CLOUDINARY_API_KEY,
    };
    const signature = signParams(params, CLOUDINARY_API_SECRET);

    const form = new URLSearchParams();
    for (const [k,v] of Object.entries(params)) form.append(k, String(v));
    form.append("signature", signature);

    // 使用 private_download 端點
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/private_download`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: resp.status, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "private_download failed", detail: errText }) };
    }

    const text = await resp.text();
    try {
      const j = JSON.parse(text);
      if (j.url) return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: j.url }) };
    } catch {}
    const urlMatch = text.match(/https?:\/\/\S+/);
    if (urlMatch) {
      return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: urlMatch[0] }) };
    }
    return { statusCode: 502, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "Unexpected response", raw: text.slice(0,200) }) };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: e && e.message ? e.message : String(e) }) };
  }
};

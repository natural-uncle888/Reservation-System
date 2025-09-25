// netlify/functions/signed-pdf.js
// 產生短效簽名 URL（預設 15 分鐘）以開啟 private/authenticated 的 PDF（或其他 raw 檔）
// 需要環境變數：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET
// 呼叫方式：POST，Header 帶 x-admin-token，Body: { public_id, format, resource_type?, type?, ttl? }
const crypto = require("crypto");

function signParams(obj, apiSecret){
  // Cloudinary 規則：key 按字母序排序，空值忽略，再接上 apiSecret 後做 SHA1
  const filtered = Object.entries(obj)
    .filter(([k,v]) => v !== undefined && v !== null && v !== "")
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  const toSign = filtered.map(([k,v]) => `${k}=${v}`).join("&") + apiSecret;
  return crypto.createHash("sha1").update(toSign).digest("hex");
}

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
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
    const public_id = String(body.public_id || "").trim();
    const format = String(body.format || "pdf").trim();
    const resource_type = String(body.resource_type || "raw").trim();
    const type = String(body.type || "upload").trim();
    const ttl = Math.min(parseInt(body.ttl || "900", 10), 3600); // 最多 1 小時

    if (!public_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "public_id required" }), headers: { "Content-Type":"application/json" } };
    }

    // 下載 URL 參數（官方 download API 會回可直接開啟的簽名 URL）
    const expires_at = Math.floor(Date.now()/1000) + ttl;
    const params = {
      public_id,
      format,
      resource_type,
      type,
      expires_at,
      attachment: false, // 在瀏覽器中打開，而不是強制下載
      api_key: CLOUDINARY_API_KEY
    };
    const signature = signParams(params, CLOUDINARY_API_SECRET);

    const form = new URLSearchParams();
    for (const [k,v] of Object.entries(params)) { form.append(k, String(v)); }
    form.append("signature", signature);

    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/download`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    const text = await resp.text();
    // 下載 API 可能回 JSON 或直接回 URL
    try {
      const j = JSON.parse(text);
      if (j.url) {
        return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: j.url, expires_at }) };
      }
    } catch {}
    // 非 JSON，嘗試抽取 URL
    const m = text.match(/https?:\/\/\S+/);
    if (m) {
      return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: m[0], expires_at }) };
    }
    return { statusCode: 502, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ error: "Unexpected response", raw: text.slice(0,200) }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e && e.message ? e.message : String(e) }), headers: { "Content-Type":"application/json" } };
  }
};

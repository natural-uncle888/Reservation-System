// netlify/functions/get-pdf-url.js
// 產生 Cloudinary 原始檔（raw/pdf）的「臨時下載連結」，用於解決 401 問題（私有/Authenticated 資源）。
// 步驟：
// 1) 驗證 x-admin-token
// 2) 先查詢資源，取得實際 type（upload/private/authenticated）
// 3) 呼叫 Admin API 的 download 端點，取得臨時可存取的 URL
//
// 需要環境變數：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET
// 用法（GET）： /.netlify/functions/get-pdf-url?public_id=booking_xxx_booking.pdf
// 回傳：{ url }，前端拿到後直接 window.open(url)

const crypto = require("crypto");

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${token}`;
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
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Cloudinary env not configured" }), headers: { "Content-Type":"application/json" } };
    }
    const tok = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
    if (!verify(tok, ADMIN_JWT_SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: { "Content-Type":"application/json" } };
    }

    const qs = new URLSearchParams(event.queryStringParameters || {});
    const public_id = qs.get("public_id");
    if (!public_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "public_id required" }), headers: { "Content-Type":"application/json" } };
    }
    const cloud = CLOUDINARY_CLOUD_NAME;

    // 1) 先查資源細節，找出 type
    const detailUrlBase = `https://api.cloudinary.com/v1_1/${cloud}/resources/raw`;
    const types = ["upload","authenticated","private"];
    let found = null, foundType = "upload";
    for (const t of types) {
      const u = `${detailUrlBase}/${t}/${encodeURIComponent(public_id)}`;
      const r = await fetch(u, { headers: { "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) } });
      if (r.ok) {
        found = await r.json();
        foundType = t;
        break;
      }
    }
    if (!found) {
      return { statusCode: 404, body: JSON.stringify({ error: "not found" }), headers: { "Content-Type":"application/json" } };
    }

    // 2) 呼叫 download 端點產生臨時下載連結
    const dlUrl = `https://api.cloudinary.com/v1_1/${cloud}/resources/raw/${foundType}/download`;
    const form = new URLSearchParams({ public_id, attachment: "false" /* inline */ });
    const d = await fetch(dlUrl, {
      method: "POST",
      headers: { "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET), "Content-Type":"application/x-www-form-urlencoded" },
      body: form.toString()
    });
    if (!d.ok) {
      const txt = await d.text();
      return { statusCode: d.status, body: JSON.stringify({ error: "download api failed", detail: txt }), headers: { "Content-Type":"application/json" } };
    }
    const dj = await d.json();
    const url = dj.url || dj.direct_url || dj.secure_url || null;
    if (!url) {
      return { statusCode: 500, body: JSON.stringify({ error: "no url from download api" }), headers: { "Content-Type":"application/json" } };
    }
    return { statusCode: 200, body: JSON.stringify({ url }), headers: { "Content-Type":"application/json" } };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }), headers: { "Content-Type":"application/json" } };
  }
};

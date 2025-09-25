// netlify/functions/pdf-url.js
// 產生 Cloudinary 的「私有/受保護資產」下載連結（一次性、短效）
// 需要：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET
// 用法：GET /.netlify/functions/pdf-url?public_id=xxx&type=upload&resource_type=raw&format=pdf
// 需帶 x-admin-token（沿用你的登入 token）

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

function sha1(s){ return crypto.createHash("sha1").update(s).digest("hex"); }

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

    const q = event.queryStringParameters || {};
    const public_id = q.public_id;
    const type = q.type || "upload";
    const resource_type = q.resource_type || "raw";
    const format = q.format || ""; // e.g., pdf
    if (!public_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing public_id" }), headers: { "Content-Type":"application/json" } };
    }

    const params = {
      public_id,
      type,
      resource_type,
      format,
      timestamp: Math.floor(Date.now()/1000),
    };
    // Build signature for /download endpoint
    const keys = Object.keys(params).filter(k => params[k] !== "" && params[k] != null && k !== "signature").sort();
    const toSign = keys.map(k => `${k}=${params[k]}`).join("&") + CLOUDINARY_API_SECRET;
    const signature = sha1(toSign);

    const body = new URLSearchParams({
      ...Object.fromEntries(keys.map(k => [k, String(params[k])])),
      api_key: CLOUDINARY_API_KEY,
      signature,
    });

    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/download`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!r.ok) {
      return { statusCode: r.status, body: await r.text() };
    }
    const data = await r.json(); // { url: "https://res.cloudinary.com/.../__cld_token__=..." }
    return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ url: data.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};

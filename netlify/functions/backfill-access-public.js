// netlify/functions/backfill-access-public.js
// 將既有的 booking* 原始檔（raw）批次改為 access_mode=public，解決開 PDF 401 的問題。
// 需要：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET
// 使用方式：
//   GET /.netlify/functions/backfill-access-public?prefix=booking&limit=50
//   需帶 x-admin-token header（與管理頁相同的登入 token）

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
      return { statusCode: 500, body: "Cloudinary env not configured" };
    }
    const tok = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
    if (!verify(tok, ADMIN_JWT_SECRET)) {
      return { statusCode: 401, body: "Unauthorized" };
    }

    const urlSearch = new URLSearchParams(event.queryStringParameters || {});
    const prefix = urlSearch.get("prefix") || "booking";
    const limit = Math.min(parseInt(urlSearch.get("limit") || "50", 10), 200);
    const cloud = CLOUDINARY_CLOUD_NAME;

    // 1) 搜尋符合前綴的 raw 資源
    const searchUrl = `https://api.cloudinary.com/v1_1/${cloud}/resources/search`;
    const searchBody = {
      expression: `public_id:${prefix}* AND resource_type=raw`,
      with_field: ["context","metadata"],
      sort_by: [{ created_at: "desc" }],
      max_results: limit
    };
    const sResp = await fetch(searchUrl, {
      method: "POST",
      headers: { "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET), "Content-Type":"application/json" },
      body: JSON.stringify(searchBody)
    });
    if (!sResp.ok) {
      return { statusCode: sResp.status, body: await sResp.text() };
    }
    const sData = await sResp.json();
    const items = sData.resources || [];

    // 2) 逐筆更新 access_mode=public（若已 public 則略過）
    const results = [];
    for (const it of items) {
      const public_id = it.public_id;
      const type = it.type || "upload"; // 默認 upload
      const updateUrl = `https://api.cloudinary.com/v1_1/${cloud}/resources/raw/${type}/${encodeURIComponent(public_id)}`;
      const form = new URLSearchParams({ access_mode: "public" });
      const uResp = await fetch(updateUrl, {
        method: "POST",
        headers: { "Authorization": basicAuthHeader(CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET), "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
      });
      const ok = uResp.ok;
      const bodyText = await uResp.text();
      results.push({ public_id, ok, body: bodyText.slice(0,200) });
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updated: results.length, results }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};

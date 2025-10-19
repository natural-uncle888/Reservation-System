
// netlify/functions/list-bookings.js
// 列出 Cloudinary 內以 booking* 為前綴的資產（支援分頁/搜尋/日期區間）
// 需要環境變數：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// 可選：CLOUDINARY_BOOKING_PREFIX（預設 booking）
// 安全性：如需簡易保護，可在此檢查自訂 header token（見下方 TODO）

const PREFIX = process.env.CLOUDINARY_BOOKING_PREFIX || "booking";
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const SEARCH_URL = CLOUD_NAME
  ? `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`
  : null;

function buildExpression({ q, from, to }) {
  const terms = [];

  // 基本條件：public_id 開頭符合 booking*
  terms.push(`public_id:${PREFIX}*`);

  // 日期區間條件
  if (from) terms.push(`created_at>=${from}`);
  if (to) terms.push(`created_at<=${to}`);

  // 關鍵字模糊搜尋（public_id 與 context 欄位）
  if (q) {
    const keyword = String(q).trim();
    const fieldsToSearch = [
      "public_id",
      "context.name",
      "context.phone",
      "context.service",
      "context.address",
      "context.brand",
      "context.note"
    ];
    const fuzzySearch = fieldsToSearch.map(field => `${field}~${keyword}`);
    terms.push(`(${fuzzySearch.join(" OR ")})`);
  }

  return terms.join(" AND ");
}

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

exports.handler = async (event, context) => {
  try {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Cloudinary credentials are not configured" }),
        headers: { "Content-Type": "application/json" }
      };
    }

    // 權限保護：驗證 x-admin-token 簽名與時效
    const tokenHeader = event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || event.headers["x-Admin-Token"];
    const SECRET = process.env.ADMIN_JWT_SECRET;
    function verify(token){
      if(!token || !SECRET) return false;
      const [data, sig] = String(token).split(".");
      if(!data || !sig) return false;
      const expect = require("crypto").createHmac("sha256", SECRET).update(data).digest("hex");
      if (expect !== sig) return false;
      try {
        const json = JSON.parse(Buffer.from(data.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"));
        if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
        return true;
      } catch { return false; }
    }
    if (!verify(tokenHeader)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: { "Content-Type": "application/json" } };
    }

    const params = new URLSearchParams(event.queryStringParameters || {});
    const cursor = params.get("cursor") || null;
    const q = params.get("q") || "";
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const limitRaw = parseInt(params.get("limit") || "30", 10);
    const max_results = Math.min(isFinite(limitRaw) ? limitRaw : 30, 100);

    const expression = buildExpression({ q, from, to });

    const payload = {
      expression,
      max_results,
      sort_by: [{ created_at: "desc" }],
      with_field: ["context","metadata"],
    };
    if (cursor) payload.next_cursor = cursor;

    const resp = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Authorization": basicAuthHeader(API_KEY, API_SECRET),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: "Cloudinary search failed", detail: text }),
        headers: { "Content-Type": "application/json" }
      };
    }

    const data = await resp.json();
    const items = (data.resources || []).map(x => ({
      public_id: x.public_id,
      created_at: x.created_at,
      bytes: x.bytes,
      resource_type: x.resource_type, // image / video / raw
      type: x.type, // upload 等
      format: x.format, // jpg/json/pdf…
      url: x.url,
      secure_url: x.secure_url,
      context: x.context || null,
      metadata: x.metadata || null,
      width: x.width,
      height: x.height,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        items,
        next_cursor: data.next_cursor || null,
        count: items.length,
      }),
      headers: { "Content-Type": "application/json" }
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e && e.message ? e.message : String(e) }),
      headers: { "Content-Type": "application/json" }
    };
  }
};

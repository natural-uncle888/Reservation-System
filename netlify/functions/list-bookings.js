// netlify/functions/list-bookings.js
// 列出 Cloudinary 內以 booking* 為前綴的資產（支援分頁/搜尋/日期區間）
// 需要：CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// 可選：CLOUDINARY_BOOKING_PREFIX（預設 booking）
// 權限：驗證 x-admin-token（與 auth-login.js 的 ADMIN_JWT_SECRET 相同）

const PREFIX = process.env.CLOUDINARY_BOOKING_PREFIX || "booking";
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const SEARCH_URL = CLOUD_NAME
  ? `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`
  : null;

function buildExpression({ q, from, to }) {
  const terms = [];
  // 只查 booking 前綴 + 原始檔（raw）與/或 pdf
  terms.push(`public_id:${PREFIX}*`);
  // 建議：raw 為 PDF，上傳用 raw/upload
  terms.push(`resource_type:raw`);
  // 若只想收斂 pdf，可加上：format=pdf
  // terms.push(`format=pdf`);
  if (from) terms.push(`created_at>=${from}`);
  if (to) terms.push(`created_at<=${to}`);
  if (q) {
    // public_id 或 context.customer / context.phone / context.service 模糊查
    // Cloudinary Search 支援 context.* 查詢
    const qSan = String(q).replace(/["]/g, "");
    terms.push(`(public_id~${qSan} OR context.customer:${qSan} OR context.phone:${qSan} OR context.service:${qSan})`);
  }
  return terms.join(" AND ");
}

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

exports.handler = async (event) => {
  try {
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Cloudinary credentials are not configured" }),
        headers: { "Content-Type": "application/json" }
      };
    }

    // ---- 驗證 x-admin-token ----
    const tokenHeader = event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || event.headers["x-Admin-Token"];
    const SECRET = process.env.ADMIN_JWT_SECRET;
    function verify(token) {
      if (!token || !SECRET) return false;
      try {
        const [data, sig] = String(token).split(".");
        if (!data || !sig) return false;
        const crypto = require("crypto");
        const e = crypto.createHmac("sha256", SECRET).update(data).digest("base64")
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
        if (e !== sig) return false;
        const json = JSON.parse(Buffer.from(data.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"));
        if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
        return true;
      } catch { return false; }
    }
    if (!verify(tokenHeader)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: { "Content-Type": "application/json" } };
    }

    // ---- 讀參數 ----
    const params = new URLSearchParams(event.queryStringParameters || {});
    const cursor = params.get("cursor") || params.get("next_cursor") || null;
    const q = params.get("q") || "";
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const limitRaw = parseInt(params.get("limit") || "30", 10);
    const max_results = Math.min(isFinite(limitRaw) ? limitRaw : 30, 100);

    // ---- 組 Cloudinary Search 請求 ----
    const expression = buildExpression({ q, from, to });
    const body = {
      expression,
      max_results,
      sort_by: [{ created_at: "desc" }],
      with_field: ["context","metadata"],
    };
    if (cursor) body.next_cursor = cursor;

    const fetch = globalThis.fetch || (await import("node-fetch")).default;
    const resp = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": basicAuthHeader(API_KEY, API_SECRET),
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return { statusCode: resp.status, body: JSON.stringify({ error: "Cloudinary search failed", detail: txt, expression }), headers: { "Content-Type": "application/json" } };
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
        ok: true,
        expression,
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

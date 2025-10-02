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
  terms.push(`public_id:${PREFIX}*`);
  if (from) terms.push(`created_at>=${from}`);
  if (to) terms.push(`created_at<=${to}`);
  if (q) {
    // public_id 模糊搜尋
    terms.push(`public_id~${q}`);
  }
  return terms.join(" AND ");
}

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

function normalize(x) {
  const c = (x.context && (x.context.custom || x.context)) || {};
  const m = x.metadata || {};
  const pick = (keys) => {
    for (const k of keys) {
      if (c && c[k] != null && String(c[k]).trim() !== "") return String(c[k]).trim();
      if (m && m[k] != null && String(m[k]).trim() !== "") return String(m[k]).trim();
    }
    return "";
  };
  return {
    name:        pick(["name","姓名","customer_name","fullname"]),
    phone:       pick(["phone","電話","phone_number","mobile","tel"]),
    service:     pick(["service","服務","service_category","service_item","select_service"]),
    address:     pick(["address","地址"]),
    brand:       pick(["brand","冷氣品牌"]),
    ac_type:     pick(["ac_type","冷氣類型"]),
    count:       pick(["count","清洗數量","quantity"]),
    floor:       pick(["floor","樓層","室內機所在樓層"]),
    is_inverter: pick(["is_inverter","變頻","是否為變頻機型系列","是否為變形金剛系列"]),
    antifungus:  pick(["antifungus","防霉抗菌處理","冷氣防霉抗菌處理"]),
    ozone:       pick(["ozone","臭氧消毒","臭氧殺菌消毒","臭氧空間消毒"]),
    extra_service: pick(["extra_service","其他清洗服務"]),
    line:        pick(["line_id","line","LINE","聯絡Line","line 或 facebook 名稱","LINE 或 Facebook 名稱"]),
    fb:          pick(["fb_name","facebook","FB"]),
    date:        pick(["date","預約日期"]),
    timeslot:    pick(["timeslot","預約時段","時段","可安排時段"]),
    contact_time:pick(["contact_time","方便聯繫時間"]),
    note:        pick(["note","備註","其他備註"]),
    pdf:         pick(["pdf","pdf_url","PDF連結","PDF"]),
  };
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
   ,
      normalized: normalize(x)
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

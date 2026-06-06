
// netlify/functions/list-bookings.js
// Modified: search q against public_id, context.* (name/phone/service) and metadata.* (phone/service)
// Added: normalize start/end dates (interpret as Asia/Taipei local dates and convert to ISO)
// env required: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_JWT_SECRET

const PREFIX = process.env.CLOUDINARY_BOOKING_PREFIX || "booking";
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const SEARCH_URL = CLOUD_NAME
  ? `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`
  : null;

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

function escapeForExpression(term){
  if(term == null) return "";
  let s = String(term).trim();
  s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const reservedRe = /[\!\(\)\{\}\[\]\*\^\~\?\:\=\\\&\>\<\s]/;
  if (reservedRe.test(s)) {
    return `"${s}"`;
  }
  return s;
}

/* Parse user-provided date string like "2025/10/01" or "2025-10-01" or "2025/10/01 13:00"
   and return an ISO 8601 timestamp in UTC suitable for Cloudinary comparisons.
   Interpretation: user dates are in Asia/Taipei (UTC+8). For "start" we set time 00:00:00,
   for "end" we set time 23:59:59.999.
*/
function parseDateToIso(dateStr, isEnd=false){
  if(!dateStr) return null;
  // normalize separators
  const s = String(dateStr).trim().replace(/\//g,'-');
  // try to extract yyyy-mm-dd and optional time
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):?(\d{1,2})?:?(\d{1,3})?)?$/);
  if(!m) return null;
  const y = parseInt(m[1],10), mo = parseInt(m[2],10), d = parseInt(m[3],10);
  let hh = 0, mm = 0, ss = 0, ms = 0;
  if(m[4]) hh = parseInt(m[4],10);
  if(m[5]) mm = parseInt(m[5],10);
  if(m[6]) { ss = parseInt(m[6],10); if(ss>99) { ms = ss; ss = 0; } }
  if(isEnd && !m[4]) { hh = 23; mm = 59; ss = 59; ms = 999; }
  // build an ISO string with +08:00 timezone (Asia/Taipei)
  // Ensure month/day padded
  const YYYY = String(y).padStart(4,'0');
  const MM = String(mo).padStart(2,'0');
  const DD = String(d).padStart(2,'0');
  const HH = String(hh).padStart(2,'0');
  const MN = String(mm).padStart(2,'0');
  const SS = String(ss).padStart(2,'0');
  const MS = String(ms).padStart(3,'0');
  const localIso = `${YYYY}-${MM}-${DD}T${HH}:${MN}:${SS}.${MS}+08:00`;
  // Convert to UTC ISO (Z)
  const dt = new Date(localIso);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function buildExpression({ q, fromIso, toIso, status }) {
  const terms = [];
  // Only booking PDFs should appear in the admin list.
  // Uploaded site photos are stored as Cloudinary image assets with public_ids like
  // booking/..._photo_1, so searching only raw resources prevents photos from
  // being shown as blank booking rows.
  terms.push("resource_type:raw");
  terms.push(`public_id:${PREFIX}*`);
  if (fromIso) terms.push(`created_at>="${fromIso}"`);
  if (toIso) terms.push(`created_at<="${toIso}"`);


  if (q) {
    const qSafe = escapeForExpression(q);
    const orParts = [
      `public_id~${qSafe}`,
      `context.name~${qSafe}`,
      `context.customer_name~${qSafe}`,
      `context.fullname~${qSafe}`,
      `context.姓名~${qSafe}`,
      `context.phone~${qSafe}`,
      `context.phone_number~${qSafe}`,
      `context.mobile~${qSafe}`,
      `context.tel~${qSafe}`,
      `context.電話~${qSafe}`,
      `metadata.phone~${qSafe}`,
      `metadata.mobile~${qSafe}`,
      `metadata.tel~${qSafe}`,
      `metadata.電話~${qSafe}`,
      `context.service~${qSafe}`,
      `context.service_item~${qSafe}`,
      `context.service_category~${qSafe}`,
      `metadata.service~${qSafe}`,
      `metadata.service_item~${qSafe}`,
      `metadata.service_category~${qSafe}`
    ];
    terms.push(`(${orParts.join(" OR ")})`);
  }

  return terms.join(" AND ");
}


function getContextObject(ctx) {
  if (!ctx) return {};
  if (typeof ctx === "object") {
    if (ctx.custom && typeof ctx.custom === "object") return { ...ctx.custom, ...ctx };
    return ctx;
  }
  if (typeof ctx === "string") {
    const obj = {};
    ctx.split("|").forEach(pair => {
      const idx = pair.indexOf("=");
      if (idx > -1) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) obj[k] = v;
      }
    });
    return obj;
  }
  return {};
}

function getAssetStatus(asset) {
  const ctx = getContextObject(asset.context);
  const meta = getContextObject(asset.metadata);
  return String(ctx.status || meta.status || "pending").trim() || "pending";
}

function statusMatchesAsset(asset, status) {
  if (!status || status === "all") return true;
  return getAssetStatus(asset) === status;
}

async function searchCloudinaryPage(payload) {
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
    const err = new Error("Cloudinary search failed");
    err.statusCode = resp.status;
    err.detail = text;
    throw err;
  }
  return resp.json();
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

    // verify x-admin-token (simple HMAC-like scheme used previously)
    const tokenHeader = (event.headers && (event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || event.headers["x-Admin-Token"])) || "";
    const SECRET = process.env.ADMIN_JWT_SECRET || "";
    function verify(token){
      if(!token || !SECRET) return false;
      const [data, sig] = String(token).split(".");
      if(!data || !sig) return false;
      try{
        const expect = require("crypto").createHmac("sha256", SECRET).update(data).digest("hex");
        if (expect !== sig) return false;
        const padded = data.replace(/-/g,"+").replace(/_/g,"/") + "===";
        const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
        return true;
      }catch(e){ return false; }
    }
    if (!verify(tokenHeader)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: { "Content-Type": "application/json" } };
    }

    // read params (POST JSON preferred, otherwise query string)
    let q = "";
    let from = "";
    let to = "";
    let cursor = null;
    let status = "";
    let max_results = 30;

    if (event.httpMethod && event.httpMethod.toUpperCase() === "POST" && event.body) {
      try {
        const jb = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        q = jb.q || jb.q === "" ? String(jb.q) : (jb.query || jb.q || "");
        from = jb.start || jb.from || jb.start_date || jb.from_date || "";
        to = jb.end || jb.to || jb.end_date || jb.to_date || "";
        cursor = jb.cursor || null;
        status = jb.status && jb.status !== "all" ? String(jb.status) : "";
        const rawLimit = parseInt(jb.limit || jb.max || jb.max_results || 30, 10);
        max_results = Math.min(isFinite(rawLimit) ? rawLimit : 30, 100);
      } catch (e) {
        // ignore parse error and fallback
      }
    }

    if ((!q && !from && !to && !cursor) && event.queryStringParameters) {
      const params = new URLSearchParams(event.queryStringParameters || {});
      cursor = params.get("cursor") || null;
      status = params.get("status") && params.get("status") !== "all" ? String(params.get("status")) : "";
      q = params.get("q") || "";
      from = params.get("from") || params.get("start") || "";
      to = params.get("to") || params.get("end") || "";
      const limitRaw = parseInt(params.get("limit") || "30", 10);
      max_results = Math.min(isFinite(limitRaw) ? limitRaw : 30, 100);
    }

    // normalize dates into ISO (UTC) strings interpreted as Asia/Taipei local dates
    const fromIso = from ? parseDateToIso(from, false) : null;
    const toIso = to ? parseDateToIso(to, true) : null;

    const expression = buildExpression({ q: String(q || ""), fromIso, toIso, status: String(status || "") });

    const payload = {
      expression,
      max_results,
      sort_by: [{ created_at: "desc" }],
      with_field: ["context","metadata"],
    };
    if (cursor) payload.next_cursor = cursor;

    let data = { resources: [], next_cursor: cursor || null };
    let cloudinaryCursor = cursor || null;
    const matchedResources = [];

    // Cloudinary context 狀態篩選在不同資源格式下可能不穩定，
    // 因此狀態改由 function 端讀取 context 後過濾。
    // 有狀態篩選時會往後抓頁，直到湊滿本頁 20 筆或沒有更多資料。
    try {
      do {
        const pagePayload = { ...payload };
        if (cloudinaryCursor) pagePayload.next_cursor = cloudinaryCursor;
        else delete pagePayload.next_cursor;

        data = await searchCloudinaryPage(pagePayload);
        const resources = data.resources || [];

        for (const asset of resources) {
          if (statusMatchesAsset(asset, status || "")) {
            matchedResources.push(asset);
            if (matchedResources.length >= max_results) break;
          }
        }

        cloudinaryCursor = data.next_cursor || null;
      } while ((status && status !== "all") && matchedResources.length < max_results && cloudinaryCursor);
    } catch (err) {
      return {
        statusCode: err.statusCode || 500,
        body: JSON.stringify({ error: "Cloudinary search failed", detail: err.detail || err.message }),
        headers: { "Content-Type": "application/json" }
      };
    }

    const items = matchedResources.map(x => ({
      public_id: x.public_id,
      created_at: x.created_at,
      bytes: x.bytes,
      resource_type: x.resource_type,
      type: x.type,
      format: x.format,
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
        next_cursor: cloudinaryCursor || null,
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

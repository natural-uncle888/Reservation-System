// netlify/functions/list-bookings.js
// Modified to search q against public_id, context.* (name/phone) and metadata.* (phone)
// Requires env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// Keeps existing behavior: date range, pagination, admin token verify

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

/* escape reserved chars in Cloudinary search expression
   - If term contains whitespace or reserved chars, we'll return a quoted version:
     e.g. "王 小" => "\"王 小\""
   - We also escape backslashes and double quotes inside the term.
*/
function escapeForExpression(term){
  if(term == null) return "";
  let s = String(term).trim();
  // escape backslash and double-quote for quoted form
  s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // reserved / special characters per docs: !(){}[]*^~?:\= & >< and whitespace
  const reservedRe = /[\!\(\)\{\}\[\]\*\^\~\?\:\=\\\&\>\<\s]/;
  if (reservedRe.test(s)) {
    return `"${s}"`;
  }
  return s;
}

/* Build expression: includes public_id prefix + optional created_at range.
   If q present, build a compound OR clause searching name/phone keys in context/metadata.
   Keys chosen to match what submit/normalizeContext uses (name, customer_name, fullname,
   phone, mobile, phone_number, tel, metadata.phone etc.)
*/
function buildExpression({ q, from, to }) {
  const terms = [];
  terms.push(`public_id:${PREFIX}*`);
  if (from) {
    // assume caller gives a date-like string; Cloudinary expects ISO-like or comparable string.
    terms.push(`created_at>=${from}`);
  }
  if (to) {
    terms.push(`created_at<=${to}`);
  }

  if (q) {
    const qSafe = escapeForExpression(q);
    // list of candidate fields to try
    const orParts = [
      `public_id~${qSafe}`,
      // context (contextual metadata / custom)
      `context.name~${qSafe}`,
      `context.customer_name~${qSafe}`,
      `context.fullname~${qSafe}`,
      `context.姓名~${qSafe}`,
      // common phone-like keys in context
      `context.phone~${qSafe}`,
      `context.phone_number~${qSafe}`,
      `context.mobile~${qSafe}`,
      `context.tel~${qSafe}`,
      `context.電話~${qSafe}`,
      // metadata (structured/custom metadata)
      `metadata.phone~${qSafe}`,
      `metadata.mobile~${qSafe}`,
      `metadata.tel~${qSafe}`,
      `metadata.電話~${qSafe}`
    ];
    // join as a grouped OR clause
    terms.push(`(${orParts.join(" OR ")})`);
  }

  return terms.join(" AND ");
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

    // verify x-admin-token (same simple HMAC-based check as before)
    const tokenHeader = (event.headers && (event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || event.headers["x-Admin-Token"])) || "";
    const SECRET = process.env.ADMIN_JWT_SECRET;
    function verify(token){
      if(!token || !SECRET) return false;
      const [data, sig] = String(token).split(".");
      if(!data || !sig) return false;
      const expect = require("crypto").createHmac("sha256", SECRET).update(data).digest("hex");
      if (expect !== sig) return false;
      try {
        const padded = data.replace(/-/g,"+").replace(/_/g,"/") + "===";
        const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
        return true;
      } catch { return false; }
    }
    if (!verify(tokenHeader)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: { "Content-Type": "application/json" } };
    }

    // --- Read params: support both GET query params and POST JSON body ---
    let q = "";
    let from = "";
    let to = "";
    let cursor = null;
    let max_results = 30;

    // prefer POST JSON body if present
    if (event.httpMethod && event.httpMethod.toUpperCase() === "POST" && event.body) {
      try {
        const jb = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        q = jb.q || jb.q === "" ? String(jb.q) : (jb.query || jb.q || "");
        from = jb.start || jb.from || jb.start_date || jb.from_date || jb.start || jb.from || "";
        to = jb.end || jb.to || jb.end_date || jb.to_date || "";
        cursor = jb.cursor || null;
        const rawLimit = parseInt(jb.limit || jb.max || jb.max_results || jb.limit || 30, 10);
        max_results = Math.min(isFinite(rawLimit) ? rawLimit : 30, 100);
      } catch (e) {
        // fallback to query string parse below
      }
    }

    // if any empty, fallback to queryStringParameters (GET)
    if ((!q && !from && !to && !cursor) && event.queryStringParameters) {
      const params = new URLSearchParams(event.queryStringParameters || {});
      cursor = params.get("cursor") || null;
      q = params.get("q") || "";
      from = params.get("from") || params.get("start") || "";
      to = params.get("to") || params.get("end") || "";
      const limitRaw = parseInt(params.get("limit") || "30", 10);
      max_results = Math.min(isFinite(limitRaw) ? limitRaw : 30, 100);
    }

    const expression = buildExpression({ q: String(q || ""), from: from || "", to: to || "" });

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

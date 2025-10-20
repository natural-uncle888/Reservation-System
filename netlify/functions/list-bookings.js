// netlify/functions/list-bookings.js
// Modified: search q against public_id, context.* (name/phone/service) and metadata.* (phone/service)
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

/* escape reserved chars in Cloudinary search expression
   If term contains whitespace or reserved chars, use quoted form.
*/
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

function buildExpression({ q, from, to }) {
  const terms = [];
  terms.push(`public_id:${PREFIX}*`);
  if (from) terms.push(`created_at>=${from}`);
  if (to) terms.push(`created_at<=${to}`);

  if (q) {
    const qSafe = escapeForExpression(q);
    // candidate fields: name-like, phone-like, and service-like keys in context / metadata
    const orParts = [
      `public_id~${qSafe}`,
      // name variants
      `context.name~${qSafe}`,
      `context.customer_name~${qSafe}`,
      `context.fullname~${qSafe}`,
      `context.姓名~${qSafe}`,
      // phone variants in context
      `context.phone~${qSafe}`,
      `context.phone_number~${qSafe}`,
      `context.mobile~${qSafe}`,
      `context.tel~${qSafe}`,
      `context.電話~${qSafe}`,
      // phone variants in metadata
      `metadata.phone~${qSafe}`,
      `metadata.mobile~${qSafe}`,
      `metadata.tel~${qSafe}`,
      `metadata.電話~${qSafe}`,
      // service / category variants
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

    // read params (POST JSON preferred, otherwise query string)
    let q = "";
    let from = "";
    let to = "";
    let cursor = null;
    let max_results = 30;

    if (event.httpMethod && event.httpMethod.toUpperCase() === "POST" && event.body) {
      try {
        const jb = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        q = jb.q || jb.q === "" ? String(jb.q) : (jb.query || jb.q || "");
        from = jb.start || jb.from || jb.start_date || jb.from_date || "";
        to = jb.end || jb.to || jb.end_date || jb.to_date || "";
        cursor = jb.cursor || null;
        const rawLimit = parseInt(jb.limit || jb.max || jb.max_results || 30, 10);
        max_results = Math.min(isFinite(rawLimit) ? rawLimit : 30, 100);
      } catch (e) {
        // ignore parse error and fallback
      }
    }

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

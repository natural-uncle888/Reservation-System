// netlify/functions/list-bookings.js
const crypto = require("crypto");

function verify(token, secret) {
  if (!token || !secret) return false;
  const [data, sig] = String(token).split(".");
  if (!data || !sig) return false;
  const expect = crypto.createHmac("sha256", secret).update(data).digest("hex");
  if (expect !== sig) return false;
  try {
    const json = JSON.parse(Buffer.from(data.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"));
    if (!json.exp || json.exp < Math.floor(Date.now()/1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseContext(rawCtx) {
  try {
    if (typeof rawCtx === "object" && rawCtx !== null) {
      return rawCtx.custom || rawCtx || {};
    }
    if (typeof rawCtx === "string") {
      return Object.fromEntries(
        rawCtx.split("|")
          .map(kv => kv.split("="))
          .filter(kv => kv.length === 2)
          .map(([k, v]) => [k.trim(), decodeURIComponent(v.trim())])
      );
    }
  } catch {}
  return {};
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const {
      CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET,
      ADMIN_JWT_SECRET
    } = process.env;

    const token = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
    if (!verify(token, ADMIN_JWT_SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}

    const keyword = String(body.keyword || "").toLowerCase().trim();
    const startDate = body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate ? new Date(body.endDate) : null;

    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/raw?max_results=500`;
    const auth = "Basic " + Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString("base64");

    const resp = await fetch(url, {
      headers: { Authorization: auth }
    });

    if (!resp.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to fetch from Cloudinary" }) };
    }

    const { resources = [] } = await resp.json();
    const result = [];

    for (const it of resources) {
      const context = parseContext(it.context);
      const created = new Date(it.created_at);

      // 日期過濾
      if (startDate && created < startDate) continue;
      if (endDate && created > endDate) continue;

      // 建立搜尋文字
      const fullText = [
        context.name,
        context.phone,
        context.line,
        context.address,
        it.public_id,
        context.service,
        context.note
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (keyword && !fullText.includes(keyword)) continue;

      result.push({
        public_id: it.public_id,
        created_at: it.created_at,
        context,
        metadata: it.metadata || {},
        resource_type: it.resource_type,
        type: it.type
      });

      if (result.length >= 50) break;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, result })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message || String(err) })
    };
  }
};

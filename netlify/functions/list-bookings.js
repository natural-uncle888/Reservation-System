// netlify/functions/list-bookings.js
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const {
      CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET,
      ADMIN_JWT_SECRET
    } = process.env;

    const tok = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
    if (!verify(tok, ADMIN_JWT_SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}

    const keyword = String(body.keyword || "").toLowerCase().trim();
    const startDate = body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate ? new Date(body.endDate) : null;

    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/raw?max_results=500`;
    const auth = "Basic " + Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString("base64");

    const rawResp = await fetch(url, {
      headers: {
        Authorization: auth
      }
    });

    if (!rawResp.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to list resources" }) };
    }

    const { resources = [] } = await rawResp.json();
    const result = [];

    for (const it of resources) {
      let context = {};

      try {
        if (typeof it.context === "string") {
          context = Object.fromEntries(
            it.context.split("|").map(kv => kv.split("=").map(x => decodeURIComponent(x.trim())))
          );
        } else if (typeof it.context === "object") {
          context = it.context.custom || it.context || {};
        }
      } catch {}

      const created = new Date(it.created_at);
      if (startDate && created < startDate) continue;
      if (endDate && created > endDate) continue;

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
      body: JSON.stringify({
        ok: true,
        result
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: e?.message || String(e)
      })
    };
  }
};

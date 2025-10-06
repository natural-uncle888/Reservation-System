
const cloudinary = require('cloudinary').v2;

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const SECRET = process.env.ADMIN_JWT_SECRET;

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
});

function verify(token) {
  if (!token || !SECRET) return false;
  const [data, sig] = String(token).split(".");
  if (!data || !sig) return false;
  const expect = require("crypto").createHmac("sha256", SECRET).update(data).digest("hex");
  if (expect !== sig) return false;
  try {
    const json = JSON.parse(Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/") + "===", "base64").toString("utf8"));
    if (!json.exp || json.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

exports.handler = async function (event) {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Cloudinary credentials not configured" }),
      headers: { "Content-Type": "application/json" },
    };
  }

  const tokenHeader = event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || event.headers["x-Admin-Token"];
  if (!verify(tokenHeader)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
      headers: { "Content-Type": "application/json" },
    };
  }

  const public_id = event.queryStringParameters?.public_id;
  if (!public_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing public_id" }),
      headers: { "Content-Type": "application/json" },
    };
  }

  try {
    const attempt_ids = [public_id, public_id.replace(/\.pdf$/, "")];

    for (const id of attempt_ids) {
      const result = await cloudinary.api.delete_resources([id]);

      if (result.deleted?.[id] === "deleted") {
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, deleted_id: id, result }),
          headers: { "Content-Type": "application/json" },
        };
      }
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Cloudinary 無法刪除：可能 public_id 錯誤或不存在", attempted_ids: attempt_ids }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
      headers: { "Content-Type": "application/json" },
    };
  }
};

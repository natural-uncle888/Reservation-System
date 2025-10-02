const { google } = require("googleapis");
const cheerio = require("cheerio");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function oauth() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/oauth2callback"
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

exports.handler = async () => {
  try {
    const auth = oauth();
    const gmail = google.gmail({ version: "v1", auth });
    const userId = process.env.GMAIL_USER;

    const list = await gmail.users.messages.list({
      userId,
      q: "from:(brevo) subject:(預約) newer_than:30d",
      maxResults: 5
    });

    if (!list.data.messages) {
      return { statusCode: 200, body: JSON.stringify({ updated: 0, note: "no messages" }) };
    }

    let updated = 0;
    for (const msg of list.data.messages) {
      const full = await gmail.users.messages.get({ userId, id: msg.id, format: "full" });

      let html = "";
      const walk = (p) => {
        if (!p) return;
        if (p.mimeType === "text/html" && p.body?.data) {
          html = Buffer.from(p.body.data, "base64").toString("utf-8");
        }
        (p.parts || []).forEach(walk);
      };
      walk(full.data.payload);

      if (!html) continue;

      const $ = cheerio.load(html);
      const name = $("td:contains('顧客姓名')").next().text().trim();
      const phone = $("td:contains('聯絡電話')").next().text().trim();
      const service = $("td:contains('服務類別')").next().text().trim();

      const context = { name, phone, service };
      const publicId = `booking_${msg.id}`;

      await cloudinary.uploader.upload_stream(
        { resource_type: "raw", public_id: publicId, type: "upload", context },
        (err) => { if (err) console.error("cloudinary error", err); }
      ).end(Buffer.from("{}", "utf-8"));

      updated++;
    }

    return { statusCode: 200, body: JSON.stringify({ updated }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

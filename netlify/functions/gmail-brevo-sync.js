// gmail-brevo-sync.js
// mode=preview：只列出找到的郵件（預設）
// mode=sync   ：解析 Brevo 信 → 回填 Cloudinary context
const { google } = require("googleapis");
const cheerio = require("cheerio");
const cloudinary = require("cloudinary").v2;

const CORS = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const err = (e) => ({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(e && e.message || e) }) });

function oauth() {
  const o = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/oauth2callback"
  );
  o.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return o;
}
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 解析 URL 參數（支援 GET ?q=...&mode=... 與 POST body.q/body.mode）
function getParams(event) {
  let q=null, mode=null;
  try {
    const url = new URL(event.rawUrl || ("https://x" + (event.path || "")) + (event.rawQuery ? ("?" + event.rawQuery) : ""));
    q = url.searchParams.get("q");
    mode = url.searchParams.get("mode");
  } catch(_) {}
  try {
    if (event.body) {
      const b = JSON.parse(event.body);
      if (b.q) q = String(b.q);
      if (b.mode) mode = String(b.mode);
    }
  } catch(_) {}
  return { q, mode };
}

// 超保守的 HTML 解析（表格兩欄 & PDF 連結）
function parseBrevoHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const map = {};
  $("table tr").each((_, tr) => {
    const tds = $(tr).find("td,th");
    if (tds.length === 2) {
      const k = $(tds[0]).text().replace(/\s+/g, " ").trim();
      const v = $(tds[1]).text().replace(/\s+/g, " ").trim();
      if (k && v) map[k] = v;
    }
  });
  const pdf = $('a[href*=".pdf"]').first().attr("href");
  if (pdf) map.PDF = pdf;
  return map;
}
const pick = (m, keys) => { for (const k of keys) { const v = m[k]; if (v && String(v).trim() !== "") return String(v).trim(); } return ""; };
function normalize(m) {
  return {
    name:          pick(m, ["顧客姓名","姓名","name"]),
    phone:         pick(m, ["聯絡電話","電話","phone"]),
    address:       pick(m, ["清洗保養地址","地址","address"]),
    service:       pick(m, ["服務類別","服務","service"]),
    ac_type:       pick(m, ["冷氣類型","ac_type"]),
    brand:         pick(m, ["冷氣品牌","brand"]),
    count:         pick(m, ["清洗數量","台數","count"]),
    floor:         pick(m, ["室內機所在樓層","樓層","floor"]),
    is_inverter:   pick(m, ["是否為變頻機型系列","變頻","is_inverter"]),
    antifungus:    pick(m, ["冷氣防霉抗菌處理","防霉抗菌","antifungus"]),
    ozone:         pick(m, ["臭氧空間消毒","臭氧殺菌消毒","臭氧","ozone"]),
    extra_service: pick(m, ["其他清洗服務","extra_service"]),
    date:          pick(m, ["預約日期","date"]),
    timeslot:      pick(m, ["預約時段","可安排時段","timeslot"]),
    contact_time:  pick(m, ["方便聯繫時間","contact_time"]),
    residence:     pick(m, ["居住地型態","residence"]),
    note:          pick(m, ["其他備註","備註","note"]),
    pdf:           pick(m, ["PDF","pdf","pdf_url"])
  };
}

exports.handler = async (event) => {
  try {
    const { q: qParam, mode: modeParam } = getParams(event);
    const mode = (modeParam || "preview").toLowerCase(); // 預設 preview
    const auth = oauth();
    const gmail = google.gmail({ version: "v1", auth });

    const userId = process.env.GMAIL_USER;
    if (!userId) return err("Missing GMAIL_USER");

    // 預設查詢：含垃圾桶/垃圾信，常見主旨/寄件人關鍵字，60天內
    const q = qParam || 'in:anywhere newer_than:60d (from:brevo OR subject:(預約 OR 預約來了 OR booking))';

    // 先列出有哪些郵件（metadata 快）
    const list = await gmail.users.messages.list({
      userId,
      q,
      maxResults: 10,
      includeSpamTrash: true
    });
    const msgs = list.data.messages || [];

    if (mode === "preview") {
      const previews = [];
      for (const m of msgs) {
        const md = await gmail.users.messages.get({
          userId, id: m.id, format: "metadata", metadataHeaders: ["Subject","From","Date"]
        });
        const hs = md.data.payload.headers || [];
        const get = (n) => (hs.find(h => h.name === n) || {}).value || "";
        previews.push({ id: m.id, subject: get("Subject"), from: get("From"), date: get("Date") });
      }
      return ok({ count: previews.length, usedQuery: q, mode, previews });
    }

    // mode=sync → 真的解析 & 回填 Cloudinary
    let updated = 0;
    for (const m of msgs) {
      const full = await gmail.users.messages.get({ userId, id: m.id, format: "full" });

      // 找 HTML 內容
      let html = "";
      const walk = (p) => { if (!p) return;
        if (p.mimeType === "text/html" && p.body && p.body.data) {
          html = Buffer.from(p.body.data, "base64").toString("utf-8");
        }
        (p.parts || []).forEach(walk);
      };
      walk(full.data.payload);
      if (!html) continue;

      // 解析＋歸一化
      const map = parseBrevoHtml(html);
      const norm = normalize(map);
      const custom = Object.assign({}, map, norm);

      // 產生 public_id（可自行改規則）
      const hs = full.data.payload.headers || [];
      const subject = (hs.find(h=>h.name==="Subject")||{}).value || "booking";
      const id = full.data.internalDate || Date.now().toString();
      let publicId = subject.replace(/[^\w\-]+/g, "_") + "_" + id;
      if (norm.pdf) {
        const m2 = norm.pdf.match(/\/([^\/]+)\.pdf$/i);
        if (m2) publicId = m2[1];
      }

      // 更新（若不存在就創一個 raw 空檔）
      try {
        await cloudinary.api.update(publicId, { resource_type: "raw", type: "upload", context: custom });
      } catch (_) {
        await new Promise((resolve, reject) => {
          const s = cloudinary.uploader.upload_stream(
            { resource_type: "raw", public_id: publicId, type: "upload", context: custom },
            (e) => e ? reject(e) : resolve()
          );
          s.end(Buffer.from("{}", "utf-8"));
        });
      }
      updated++;
    }
    return ok({ mode, usedQuery: q, updated });

  } catch (e) {
    console.error(e);
    return err(e);
  }
};

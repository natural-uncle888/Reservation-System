// netlify/functions/submit.js
// Brevo API 發信＋Cloudinary 備份；寄件者以 EMAIL_FROM 優先（缺少時用 BREVO_SENDER_ID）

const crypto = require("crypto");

// ===== 解析請求 =====
function parseBody(event){
  const headers = event.headers || {};
  const ct = (headers["content-type"] || headers["Content-Type"] || "").split(";")[0].trim().toLowerCase();
  if (ct === "application/json" || !ct) {
    try { return JSON.parse(event.body || "{}"); } catch { return {}; }
  }
  if (ct === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(event.body || "");
    const obj = {};
    for (const [k, v] of params.entries()) {
      if (obj[k] === undefined) obj[k] = v;
      else if (Array.isArray(obj[k])) obj[k].push(v);
      else obj[k] = [obj[k], v];
    }
    return obj;
  }
  try { return JSON.parse(event.body || "{}"); } catch { return {}; }
}

// ===== HTML 工具 =====
function fw2hw(s){ return String(s).replace(/[\uFF10-\uFF19]/g, d => String.fromCharCode(d.charCodeAt(0)-0xFF10+0x30)); }
function nb(s){ return fw2hw(String(s)).replace(/\u3000/g," ").trim(); }
function nk(s){ return nb(s).toLowerCase().replace(/\s+/g," "); }
function splitVals(v){
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(splitVals);
  const s = nb(v);
  return s.split(/[、，,;|/:：]+|\s{2,}/).map(x=>x.trim()).filter(Boolean);
}
function isPH(v){ const t = nb(v).toLowerCase(); return t==="其他"||t==="other"||t==="請輸入"||t==="自填"||t==="自行填寫"; }
function dedupMerge(){
  const seen = new Set(), out = [];
  for (let x of Array.from(arguments).flatMap(splitVals)) {
    if (!x || isPH(x)) continue;
    x = String(x).replace(/^(其他|other)\s*[:：]\s*/i,"").trim();
    const key = nk(x).replace(/[樓層f台]/g,"");
    if (key && !seen.has(key)) { seen.add(key); out.push(x); }
  }
  return out;
}
function numOnly(s){ return /^[0-9]+$/.test(nb(s)); }
function nInt(s){ const m = nb(s).match(/[0-9]+/); return m?parseInt(m[0],10):NaN; }
function fmtCount(s){ const n = nInt(s); if (!Number.isFinite(n)) return s; return numOnly(s) && n >= 5 ? `${n} 台` : s; }
function fmtFloor(s){
  const n = nInt(s);
  if (!Number.isFinite(n)) return s.replace(/F$/i,"樓");
  if (numOnly(s) && n >= 5) return `${n} 樓`;
  if (/^[0-9]+f$/i.test(nb(s))) return `${n} 樓`;
  return s;
}
function tr(label,val){
  if (val==null || val==="" || (Array.isArray(val) && val.length===0)) return "";
  const v = Array.isArray(val) ? val.join("、") : String(val);
  return `<tr>
    <td style="padding:10px;border:1px solid #e5e7eb;background:#f9fafb;width:220px;"><b>${label}</b></td>
    <td style="padding:10px;border:1px solid #e5e7eb;white-space:pre-wrap;">${v}</td>
  </tr>`;
}
function section(title,rows){
  if (!rows) return "";
  return `<h3 style="color:#2b2d6e;">【${title}】</h3>
<table style="border-collapse:collapse;width:100%;margin:8px 0;">${rows}</table>`;
}

// ===== 依規則產生 Email HTML =====
function buildEmailHtml(p){
  const indoor = dedupMerge(p.indoor_floor, p.indoor_floor_other).map(fmtFloor).join("、");
  const brand  = dedupMerge(p.ac_brand,      p.ac_brand_other).join("、");
  const countArr = dedupMerge(p.ac_count, p.ac_count_other).map(fmtCount);
  const count  = countArr.length ? countArr.join("、") : (p.ac_count || "");

  const service = [
    tr("服務類別", p.service_category),
    tr("冷氣類型", p.ac_type),
    tr("清洗數量", count),
    tr("室內機所在樓層", indoor),
    tr("冷氣品牌", brand)
  ].join("");

  const contact = [
    tr("與我們聯繫方式", p.contact_method),
    tr("LINE 名稱 or Facebook 名稱", p.line_or_fb)
  ].join("");

  const booking = [
    tr("可安排時段", p.timeslot),
    tr("顧客姓名", p.customer_name),
    tr("聯繫電話", p.phone),
    tr("清洗保養地址", p.address),
    tr("居住地型態", p.house_type),
    tr("其他備註說明", p.note)
  ].join("");

  const svc = String(p.service_category||"");
  const isGroup = /團購/.test(svc), isBulk = /大量清洗/.test(svc);
  let freeTitle = "", freeRows = "";
  if (isGroup && p.group_notes){ freeTitle = "團購自由填寫"; freeRows = tr("團購自由填寫", p.group_notes); }
  if (isBulk  && p.bulk_notes ){ freeTitle = "大量清洗需求"; freeRows = tr("大量清洗需求", p.bulk_notes ); }

  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111827;">
${freeTitle?section(freeTitle, freeRows):""}
${section("服務資訊", service)}
${section("聯繫名稱說明", contact)}
${section("預約資料填寫", booking)}
</div>`;
}

// ===== 輔助：public_id 與 Cloudinary 簽名 =====
function makePublicId(p){
  if (p.public_id) return String(p.public_id);
  if (p._id) return String(p._id);
  const seed = [p.customer_name||"", p.phone||"", p.address||"", p.service_category||"", Date.now()].join("|");
  const h = crypto.createHash("sha1").update(seed).digest("hex").slice(0,12);
  return `booking_${h}`;
}
function cloudinarySign(params, apiSecret){
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + apiSecret;
  return crypto.createHash("sha1").update(toSign).digest("hex");
}

// ===== 主處理 =====
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const p = parseBody(event);

    const path = (p._page && p._page.path ? String(p._page.path) : (event.rawUrl || "")).toLowerCase();
    const isFinal = p._final === true || path.includes("final-booking");
    if (!isFinal) {
      return { statusCode: 200, body: JSON.stringify({ ok:true, stage:"ignored_non_final" }) };
    }

    const subject = `${process.env.EMAIL_SUBJECT_PREFIX || ""}${p.subject || "新預約通知"}`;
    const html = buildEmailHtml(p);

    const toList = String(process.env.EMAIL_TO || process.env.MAIL_TO || "")
      .split(",").map(s=>s.trim()).filter(Boolean).map(email=>({ email }));
    if (!toList.length) throw new Error("EMAIL_TO not set");

    const sender = process.env.EMAIL_FROM
      ? { email: process.env.EMAIL_FROM, name: "自然大叔" }
      : (process.env.BREVO_SENDER_ID ? { id: Number(process.env.BREVO_SENDER_ID) } : null);
    if (!sender || (!sender.id && !sender.email)) throw new Error("Missing EMAIL_FROM or BREVO_SENDER_ID");

    const replyTo = p.email ? [{ email: String(p.email) }] : undefined;
    const tags = [ "booking", (p.service_category||"unknown") ].filter(Boolean);

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender,
        to: toList,
        subject,
        htmlContent: `<!doctype html><html><body>${html}</body></html>`,
        replyTo,
        tags
      })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Brevo ${res.status}: ${text}`);
    }

    // Cloudinary 備份（可選）
    try {
      const cloud = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (cloud && apiKey && apiSecret) {
        const ts = Math.floor(Date.now()/1000);
        const public_id = makePublicId(p);
        const signature = cloudinarySign({ public_id, timestamp: ts }, apiSecret);
        const endpoint = `https://api.cloudinary.com/v1_1/${cloud}/raw/upload`;
        const fd = new FormData();
        fd.append("file", new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), `${public_id}.json`);
        fd.append("public_id", public_id);
        fd.append("timestamp", String(ts));
        fd.append("api_key", apiKey);
        fd.append("signature", signature);
        fd.append("overwrite", "false");
        const up = await fetch(endpoint, { method:"POST", body: fd });
        if (!up.ok) {
          const t = await up.text();
          if (!/already exists|409/.test(t)) console.warn("cloudinary upload warn:", t);
        }
      }
    } catch (e) {
      console.warn("cloudinary backup skipped:", String(e && e.message) || e);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((err && err.message) || err) }) };
  }
};

// netlify/functions/submit.js
// 使用 Brevo API 發信（EMAIL_FROM 或 BREVO_SENDER_ID 必須其一存在）

// ===== 共用 HTML 產生工具 =====
function fw2hw(s){ return String(s).replace(/[\uFF10-\uFF19]/g, d => String.fromCharCode(d.charCodeAt(0)-0xFF10+0x30)); }
function nb(s){ return fw2hw(String(s)).replace(/\u3000/g," ").trim(); }
function nk(s){ return nb(s).toLowerCase().replace(/\s+/g," "); }
function splitVals(v){
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(splitVals);
  const s = nb(v);
  // 以頓號、逗號、分號、豎線、斜線、冒號（含全形）與連續空白切分
  return s.split(/[、，,;|/:：]+|\s{2,}/).map(x=>x.trim()).filter(Boolean);
}
function isPH(v){ const t = nb(v).toLowerCase(); return t==="其他"||t==="other"||t==="請輸入"||t==="自填"||t==="自行填寫"; }
function dedupMerge(){
  const seen = new Set(), out = [];
  for (let x of Array.from(arguments).flatMap(splitVals)) {
    if (!x || isPH(x)) continue;
    // 去掉「其他：」前綴
    x = String(x).replace(/^(其他|other)\s*[:：]\s*/i,"").trim();
    // 去單位後做 Key，避免「5F」「5 樓」重複
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
  if (!Number.isFinite(n)) return s.replace(/F$/i,"樓");   // 5F -> 5樓
  if (numOnly(s) && n >= 5) return `${n} 樓`;             // 純數字且 >=5 自動補單位
  if (/^[0-9]+f$/i.test(nb(s))) return `${n} 樓`;         // 5f -> 5樓
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

// ===== 根據你的規則產生信件 HTML =====
function buildEmailHtml(p){
  // AC 多選 + 其他 合併與單位補齊
  const indoor = dedupMerge(p.indoor_floor, p.indoor_floor_other).map(fmtFloor).join("、");
  const brand  = dedupMerge(p.ac_brand,      p.ac_brand_other).join("、");
  const countArr = dedupMerge(p.ac_count, p.ac_count_other).map(fmtCount);
  const count  = countArr.length ? countArr.join("、") : (p.ac_count || "");

  const service = [
    tr("服務類別", p.service_category),
    tr("冷氣類型", p.ac_type),
    tr("清洗數量", count),
    tr("室內機所在樓層", indoor),
    tr("冷氣品牌", brand),
  ].join("");

  const contact = [
    tr("與我們聯繫方式", p.contact_method),
    tr("LINE 名稱 or Facebook 名稱", p.line_or_fb),
  ].join("");

  const booking = [
    tr("可安排時段", p.timeslot),
    tr("顧客姓名", p.customer_name),
    tr("聯繫電話", p.phone),
    tr("清洗保養地址", p.address),
    tr("居住地型態", p.house_type),
    tr("其他備註說明", p.note),
  ].join("");

  // 自由填寫：僅在 團購／大量清洗 顯示
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

// ===== Netlify Function（Brevo API）=====
exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const p = JSON.parse(event.body || "{}");
    const subject = `${process.env.EMAIL_SUBJECT_PREFIX || ""}${p.subject || "新預約通知"}`;
    const html = buildEmailHtml(p);

    // 收件人
    const toList = String(process.env.EMAIL_TO || "")
      .split(",")
      .map(e => e.trim())
      .filter(Boolean)
      .map(email => ({ email }));
    if (!toList.length) throw new Error("EMAIL_TO not set");

    // 寄件者：優先使用 SENDER_ID，否則用 EMAIL_FROM
    const sender = process.env.BREVO_SENDER_ID
      ? { id: Number(process.env.BREVO_SENDER_ID) }
      : (process.env.EMAIL_FROM ? { email: process.env.EMAIL_FROM, name: "Booking System" } : null);
    if (!sender || (!sender.id && !sender.email)) {
      throw new Error("Missing EMAIL_FROM or BREVO_SENDER_ID");
    }

    // 呼叫 Brevo API
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: toList,
        subject,
        htmlContent: `<!doctype html><html><body>${html}</body></html>`
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Brevo ${res.status}: ${text}`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((err && err.message) || err) }) };
  }
};

// server.js (含 /healthz, /api/send, /submit；Brevo；信件表格排版)
const express = require("express");
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
const Brevo = require("@getbrevo/brevo");

const app = express();
app.use((req,res,next)=>{ res.set("Cache-Control","no-store"); next(); });
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

const { BREVO_API_KEY, MAIL_FROM, MAIL_TO, MAIL_SUBJECT, PORT } = process.env;
if (!BREVO_API_KEY || !MAIL_FROM || !MAIL_TO || !MAIL_SUBJECT) {
  console.error("Missing env: BREVO_API_KEY / MAIL_FROM / MAIL_TO / MAIL_SUBJECT");
  process.exit(1);
}

// Brevo client
const api = new Brevo.TransactionalEmailsApi();
api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, BREVO_API_KEY);

// 健康檢查
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// -------- 信件樣板：表格排版 --------
function esc(x){ return String(x==null?'':x).replace(/[&<>"']/g,s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s])); }
function show(v){ return Array.isArray(v) ? v.filter(Boolean).join('、') : esc(v); }
function tr(label, value){
  if(value==null || value==='' || (Array.isArray(value)&&!value.length)) return '';
  return `<tr>
    <td style="padding:10px;border:1px solid #e5e7eb;background:#f9fafb;width:220px;"><b>${label}</b></td>
    <td style="padding:10px;border:1px solid #e5e7eb;">${show(value)}</td>
  </tr>`;
}
function section(title, rowsHtml){
  if(!rowsHtml) return '';
  return `<h3 style="margin:18px 0 8px;">【${title}】</h3>
<table style="border-collapse:collapse;width:100%;font-family:system-ui,Segoe UI,Arial,sans-serif;">${rowsHtml}</table>`;
}
function buildEmailHtml(p){
  const contact = [
    tr('與我們聯繫方式', p.contact_method),
    tr('LINE 名稱 or Facebook 名稱', p.social_name),
  ].join('');

  const booking = [
    tr('可安排時段', p.timeslot),
    tr('顧客姓名', p.name),
    tr('聯繫電話', p.phone),
    tr('方便聯繫時間', p.contact_time_preference),
    tr('清洗保養地址', p.address),
    tr('居住地型態', p.housing_type),
    tr('其他備註說明', p.note),
  ].join('');
  // 合併 + 去重 + 單位
  const indoorMerged = dedupMerge(p.indoor_floor, p.indoor_floor_other).map(fmtFloorToken);
  const brandMerged  = dedupMerge(p.ac_brand,      p.ac_brand_other);
  const countMerged  = dedupMerge(p.ac_count,      p.ac_count_other).map(fmtCountToken);
  const indoorDisplay = indoorMerged.length ? joinDisplay(indoorMerged) : '';
  const brandDisplay  = brandMerged.length  ? joinDisplay(brandMerged)  : '';
  const countDisplay  = countMerged.length  ? joinDisplay(countMerged)  : (p.ac_count || '');


  const service = [
    tr('服務類別', p.service_category),
    tr('冷氣類型', p.ac_type),
    tr('清洗數量', countDisplay),
    tr('室內機所在樓層', indoorDisplay),
    tr('冷氣品牌', brandDisplay),
    tr('是否為變形金剛系列', p.ac_transformer_series),
    tr('防霉抗菌', p.anti_mold),
    tr('臭氧消毒', p.ozone),
    tr('洗衣機台數', p.washer_count),
    tr('洗衣機樓層', p.washer_floor),
    tr('水塔顆數', p.tank_count),
    tr('水管清洗戶型', p.pipe_service),
    tr('水管清洗原因', p.pipe_reason),
  ].join('');

  
  // ===== Helpers (strict split, no TDZ) =====
  function fw2hw(s){ return String(s).replace(/[\uFF10-\uFF19]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30)); }
  function normBase(s){ return fw2hw(String(s)).replace(/\u3000/g,' ').trim(); }
  function normKey(s){ return normBase(s).toLowerCase().replace(/\s+/g,' '); }
  function splitValues(v){
    if (v == null) return [];
    if (Array.isArray(v)) return v.flatMap(splitValues);
    const s = normBase(v);
    // split by 、 ， , ; | / : ： and repeated spaces
    return s.split(/[、，,;|/:：]+|\s{2,}/).map(x=>x.trim()).filter(Boolean);
  }
  function stripOtherPrefix(v){
    return String(v).replace(/^(其他|other)\s*[:：]\s*/i,'').trim();
  }
  function isPlaceholder(v){
    const t = normBase(v).toLowerCase();
    return t==='其他' || t==='other' || t==='請輸入' || t==='自填' || t==='自行填寫';
  }
  function dedupMerge(){
    const vals = Array.prototype.slice.call(arguments);
    const seen = new Set(); const out = [];
    for (let v of vals.flatMap(splitValues)) {
      if (!v) continue;
      if (isPlaceholder(v)) continue;
      v = stripOtherPrefix(v);
      if (!v) continue;
      const k = normKey(v).replace(/[樓層f台]/g,'');
      if (k && !seen.has(k)) { seen.add(k); out.push(String(v).trim()); }
    }
    return out;
  }
  function isNumericToken(s){ return /^[0-9]+$/.test(normBase(s)); }
  function parseIntSafe(s){ const m = normBase(s).match(/[0-9]+/); return m? parseInt(m[0],10) : NaN; }
  function fmtCountToken(s){
    const n = parseIntSafe(s);
    if (!Number.isFinite(n)) return s;
    return isNumericToken(s) && n >= 5 ? `${n} 台` : s;
  }
  function fmtFloorToken(s){
    const n = parseIntSafe(s);
    if (!Number.isFinite(n)) return s.replace(/F$/i,'樓');
    if (isNumericToken(s) && n >= 5) return `${n} 樓`;
    if (/^[0-9]+f$/i.test(normBase(s))) return `${n} 樓`;
    return s;
  }
  function joinDisplay(arr){ return arr.join('、'); }
return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111827;">
${section('服務資訊', service)}
${section('聯繫名稱說明', contact)}
${section('預約資料填寫', booking)}
</div>`;
}

// 共用寄信
async function sendMail(html, subject = MAIL_SUBJECT) {
  return api.sendTransacEmail({
    sender: { email: MAIL_FROM, name: "自然大叔" },
    to: [{ email: MAIL_TO }],
    subject,
    htmlContent: html,
  });
}

// 舊的 JSON 測試寄信端點（保留）
app.post("/api/send", async (req, res) => {
  try {
    const rows = Object.entries(req.body || {})
      .map(([k, v]) => `<tr><td style="padding:6px;border:1px solid #ddd;"><b>${k}</b></td><td style="padding:6px;border:1px solid #ddd;">${Array.isArray(v)?v.join("、"):String(v)}</td></tr>`)
      .join("");
    const html = `<h3>新預約通知（/api/send）</h3><table style="border-collapse:collapse;">${rows}</table>`;
    const resp = await sendMail(html);
    res.json({ ok: true, resp });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// 最終預約提交：前端改呼叫 /submit
app.post("/submit", async (req, res) => {
  try {
    const payload = req.body || {};
    const html = buildEmailHtml(payload);
    const resp = await sendMail(html);
    res.json({ ok: true, resp });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// 靜態網站（public 為根）
const publicDir = path.join(__dirname, "public");
app.use("/", express.static(publicDir));
// 其他路徑回 index.html（若非 SPA 可移除）
app.get("*", (req, res, next) =>
  res.sendFile(path.join(publicDir, "index.html"), err => err && next())
);

const port = Number(PORT || 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

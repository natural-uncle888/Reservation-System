// netlify/functions/submit.js
// pdf-lib + Cloudinary，強化字型尋找：PDF_FONT_BASE64 > 多候選路徑

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");

const nb = v => (v == null ? "" : String(v)).trim();
const nk = v => nb(v).replace(/\s+/g, "");
const toArr = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);

function parseBody(event){const h=event.headers||{};const ct=(h["content-type"]||h["Content-Type"]||"").split(";")[0].trim().toLowerCase();if(ct==="application/json"||!ct){try{return JSON.parse(event.body||"{}");}catch{return{};}}if(ct==="application/x-www-form-urlencoded"){const params=new URLSearchParams(event.body||"");const obj={};for(const[k,v]of params.entries())obj[k]=v;return obj;}return{};}

const tr=(k,v)=>{if(v==null)return"";const t=Array.isArray(v)?v.join("、"):nb(v);if(!t)return"";return`<tr><th style="text-align:left;width:160px;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;white-space:nowrap;">${k}</th><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#111827;">${t}</td></tr>`;};
const section=(title,rows)=>{if(!rows||!nb(rows))return"";return`<div style="margin:18px 0;padding:14px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;"><h3 style="margin:0 0 10px;font-size:16px;color:#2563eb;">${title}</h3><table style="border-collapse:collapse;width:100%;">${rows}</table></div>`;};

function sortKnownFirst(list, known){
  const arr = toArr(list).map(nb).filter(Boolean);
  const seen=new Set(); const uniq=arr.filter(x=>{if(seen.has(x))return false; seen.add(x); return true;});
  const customs=uniq.filter(x=>/^其他/.test(x));
  const normals=uniq.filter(x=>!/^其他/.test(x));
  const ordered=[]; for(const k of known) if (normals.includes(k)) ordered.push(k);
  for(const x of normals) if(!known.includes(x)) ordered.push(x);
  ordered.push(...customs);
  return ordered.length===1?ordered[0]:ordered;
}

function buildEmailHtml(p){
  const service=[
    tr("服務類別",p.service_category),
    tr("冷氣類型",p.ac_type),
    tr("清洗數量",p.ac_count),
    tr("室內機所在樓層",p.indoor_floor),
    tr("冷氣品牌",p.ac_brand),
    tr("是否為變形金剛系列",p.ac_transformer_series)
  ].join("");

  const addon=[ tr("冷氣防霉抗菌處理",p.anti_mold?"需要":""), tr("臭氧空間消毒",p.ozone?"需要":"") ].join("");
  const otherSvc=[ tr("直立式洗衣機台數",p.washer_count), tr("洗衣機樓層",Array.isArray(p.washer_floor)?p.washer_floor.join("、"):p.washer_floor), tr("自來水管清洗",p.pipe_service), tr("水管清洗原因",p.pipe_reason), tr("水塔清洗台數",p.tank_count) ].join("");
  const contact=[ tr("與我們聯繫方式",p.contact_method), tr("LINE 名稱 or Facebook 名稱",p.line_or_fb) ].join("");

  const KNOWN=["平日","假日","上午","下午","晚上","皆可"];
  const timeslotCustom = nb(p.timeslot_other) || nb(p.time_other);
  const timeslot = sortKnownFirst(toArr(p.timeslot).concat(timeslotCustom?[`其他指定時間：${timeslotCustom}`]:[]), KNOWN);
  const contactCustom = nb(p.contact_time_preference_other);
  const contactPref = sortKnownFirst(toArr(p.contact_time_preference).concat(contactCustom?[`其他指定時間：${contactCustom}`]:[]), KNOWN);

  const booking=[
    tr("可安排時段",timeslot),
    tr("方便聯繫時間",contactPref),
    tr("顧客姓名",p.customer_name),
    tr("聯繫電話",p.phone),
    tr("清洗保養地址",p.address),
    tr("居住地型態",p.house_type||p.housing_type),
    tr("其他備註說明",p.note)
  ].join("");

  const svc=String(p.service_category||""); const isGroup=/團購/.test(svc),isBulk=/大量清洗/.test(svc);
  let freeTitle="",freeRows=""; if(isGroup&&p.group_notes){freeTitle="團購自由填寫";freeRows=tr("團購自由填寫",p.group_notes);} if(isBulk&&p.bulk_notes){freeTitle="大量清洗需求";freeRows=tr("大量清洗需求",p.bulk_notes);}

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;background:#ffffff;color:#111827;">${freeTitle?section(freeTitle,freeRows):""}${section("服務資訊",service)}${addon.trim()?section("防霉・消毒｜加購服務專區",addon):""}${otherSvc.trim()?section("其他清洗服務",otherSvc):""}${section("聯繫名稱說明",contact)}${section("預約資料填寫",booking)}</div>`;
}

// ---------- 字型載入（多路徑） ----------
async function loadChineseFontBytes() {
  const tried = [];
  const b64 = process.env.PDF_FONT_BASE64;
  if (b64 && b64.length > 1000) {
    try { return Buffer.from(b64, 'base64'); } catch {}
  }
  const candidates = [
    path.join(__dirname, "fonts", "NotoSansTC-Regular.otf"),
    path.join(__dirname, "..", "fonts", "NotoSansTC-Regular.otf"),
    path.join(process.cwd(), "netlify", "functions", "fonts", "NotoSansTC-Regular.otf"),
    path.join(process.cwd(), "functions", "fonts", "NotoSansTC-Regular.otf")
  ];
  for (const p of candidates) {
    tried.push(p);
    try { if (fs.existsSync(p)) return fs.readFileSync(p); } catch {}
  }
  const msg = "找不到可用字型。已嘗試路徑：\n" + tried.join("\n");
  throw new Error(msg);
}

// ---------- 產生 PDF ----------
async function buildPdfBuffer(p){
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  let { height } = page.getSize();
  const fontBytes = await loadChineseFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  let y = height - 50;

  const draw = (txt, opts={}) => {
    page.drawText(txt, Object.assign({ x: 50, y, size: 12, font, color: rgb(0,0,0) }, opts));
    y -= 18;
    if (y < 60) { page = pdfDoc.addPage([595.28, 841.89]); height = page.getSize().height; y = height - 50; }
  };
  const addRow = (k, v) => {
    if (v == null || v === "" || (Array.isArray(v) && v.length===0)) return;
    const text = Array.isArray(v) ? v.join("、") : String(v);
    draw(`${k}：${text}`);
  };

  draw("新預約單", { size: 16, color: rgb(0.15,0.39,0.92) });
  draw(new Date().toISOString(), { size: 10, color: rgb(0.4,0.45,0.5) }); y -= 6;

  addRow("服務類別", p.service_category);
  addRow("冷氣類型", p.ac_type);
  addRow("清洗數量", p.ac_count);
  addRow("室內機所在樓層", p.indoor_floor);
  addRow("冷氣品牌", p.ac_brand);
  addRow("防霉抗菌", p.anti_mold ? "需要" : "");
  addRow("臭氧消毒", p.ozone ? "需要" : "");
  addRow("洗衣機台數", p.washer_count);
  addRow("洗衣機樓層", p.washer_floor);
  addRow("自來水管清洗", p.pipe_service);
  addRow("水管清洗原因", p.pipe_reason);
  addRow("水塔清洗台數", p.tank_count);
  addRow("與我們聯繫方式", p.contact_method);
  addRow("LINE/FB 名稱", p.line_or_fb);
  addRow("可安排時段", p.timeslot);
  addRow("方便聯繫時間", p.contact_time_preference);
  addRow("顧客姓名", p.customer_name);
  addRow("聯繫電話", p.phone);
  addRow("清洗保養地址", p.address);
  addRow("居住地型態", p.house_type || p.housing_type);
  addRow("其他備註說明", p.note);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ---------- Cloudinary 簽名 ----------
function makePublicId(p){ if (p.public_id) return String(p.public_id); if (p._id) return String(p._id);
  const seed = [p.customer_name||"", p.phone||"", p.address||"", p.service_category||"", Date.now()].join("|");
  const h = crypto.createHash("sha1").update(seed).digest("hex").slice(0,12); return `booking_${h}`; }
function cloudinarySign(params, apiSecret){ const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + apiSecret; return crypto.createHash("sha1").update(toSign).digest("hex"); }

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try{
    const p = parseBody(event);
    p.customer_name = p.customer_name || p.name;
    p.line_or_fb    = p.line_or_fb    || p.social_name;
    p.house_type    = p.house_type    || p.housing_type;

    const pathStr = (p._page && p._page.path ? String(p._page.path) : (event.rawUrl || "")).toLowerCase();
    const isFinal = p._final === true || pathStr.includes("final-booking");
    if (!isFinal) return { statusCode: 200, body: JSON.stringify({ ok:true, stage:"ignored_non_final" }) };

    const subject = `${process.env.EMAIL_SUBJECT_PREFIX || ""}${p.subject || "新預約通知"}`;
    const html = buildEmailHtml(p);

    const toList = String(process.env.EMAIL_TO || process.env.MAIL_TO || "").split(",").map(s=>s.trim()).filter(Boolean).map(email=>({ email }));
    if (!toList.length) throw new Error("EMAIL_TO 未設定");

    const senderEmail = nb(process.env.EMAIL_FROM);
    const senderId = nb(process.env.BREVO_SENDER_ID);
    if (!senderEmail && !senderId) throw new Error("Missing EMAIL_FROM or BREVO_SENDER_ID");
    const sender = senderEmail ? { email: senderEmail } : { id: Number(senderId) };

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": nb(process.env.BREVO_API_KEY), "content-type":"application/json" },
      body: JSON.stringify({ sender, to: toList, subject, htmlContent: html, tags:["reservation"] })
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);

    // 上傳 Cloudinary（如有設定）
    const cloud = nb(process.env.CLOUDINARY_CLOUD_NAME);
    const apiKey = nb(process.env.CLOUDINARY_API_KEY);
    const apiSecret = nb(process.env.CLOUDINARY_API_SECRET);
    let cloudinaryUpload = null;
    if (cloud && apiKey && apiSecret){
      const pdf = await buildPdfBuffer(p);
      const public_id = makePublicId(p) + "_booking";
      const timestamp = Math.floor(Date.now()/1000);
      const tags = ["reservation", nb(p.service_category)].filter(Boolean).join(",");
      const signature = cloudinarySign({ public_id, timestamp, tags }, apiSecret);
      const fileDataURI = `data:application/pdf;base64,${pdf.toString('base64')}`;
      const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/upload`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: fileDataURI, public_id, api_key: apiKey, timestamp, signature, tags })
      });
      cloudinaryUpload = await up.text();
    }

    return { statusCode: 200, body: JSON.stringify({ ok:true, cloudinary: cloudinaryUpload ? "uploaded" : "skipped" }) };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: String((err && err.message) || err) }) };
  }
};

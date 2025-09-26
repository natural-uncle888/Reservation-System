
// ==== Injected by automation: buildContext (expand all booking fields into Cloudinary context) ====
function __pick(obj, keys){ for (const k of keys){ if (obj && obj[k]!=null && String(obj[k]).trim()!=="") return String(obj[k]).trim(); } return ""; }
function buildContext(p){
  const ctxPairs = {
    // 基本
    name: __pick(p, ["customer_name","name","姓名"]),
    phone: __pick(p, ["phone","phone_number","mobile","tel","電話"]),
    service: __pick(p, ["service","service_category","service_item","select_service","服務"]),
    address: __pick(p, ["address","地址"]),
    area: __pick(p, ["area","city","region","地區"]),
    source: __pick(p, ["subject","page_title","page","來源"]),
    // 服務細節
    ac_type: __pick(p, ["ac_type","冷氣類型"]),
    count: __pick(p, ["count","quantity","清洗數量","ac_count"]),
    floor: __pick(p, ["floor","樓層","室內機所在樓層","indoor_floor"]),
    brand: __pick(p, ["brand","冷氣品牌","ac_brand"]),
    is_inverter: __pick(p, ["is_inverter","變頻","是否為變頻機型系列"]),
    // 加購/其他
    antifungus: __pick(p, ["antifungus","冷氣防霉抗菌處理","anti_mold"]),
    ozone: __pick(p, ["ozone","臭氧殺菌消毒"]),
    extra_service: __pick(p, ["extra_service","其他清洗服務"]),
    // 聯絡
    line_id: __pick(p, ["line_id","line","LINE","聯絡Line"]),
    fb_name: __pick(p, ["fb_name","facebook","FB","LINE & Facebook 姓名"]),
    // 預約資訊
    date: __pick(p, ["date","預約日期"]),
    timeslot: __pick(p, ["timeslot","預約時段"]),
    note: __pick(p, ["note","備註"]),
    contact_time_preference: __pick(p, ["contact_time_preference","聯絡時間"]),
  };
  // 轉為 Cloudinary context（key=value|...），避免 | 造成分隔錯誤
  const context = Object.entries(ctxPairs)
    .filter(([k,v]) => v && String(v).trim() !== "")
    .map(([k,v]) => `${k}=${String(v).replace(/\|/g,'/')}`)
    .join('|');
  return context;
}
// ==== /Injected buildContext ====

// netlify/functions/submit.js
// Brevo 寄信 + 中文 PDF（pdf-lib + fontkit，本地字型）+ Cloudinary 上傳
// 必填環境：BREVO_API_KEY, (EMAIL_FROM 或 BREVO_SENDER_ID), EMAIL_TO
// 選填環境：EMAIL_SUBJECT_PREFIX, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// 本地字型：netlify/functions/fonts/NotoSansTC-Regular.otf

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const nb = v => (v == null ? "" : String(v)).trim();
const toArr = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);

function parseBody(event){
  const h=event.headers||{};
  const ct=(h["content-type"]||h["Content-Type"]||"").split(";")[0].trim().toLowerCase();
  if(ct==="application/json"||!ct){ try{return JSON.parse(event.body||"{}");}catch{return{};} }
  if(ct==="application/x-www-form-urlencoded"){
    const params=new URLSearchParams(event.body||""); const obj={};
    for(const[k,v]of params.entries())obj[k]=v; return obj;
  }
  return {};
}

const tr=(k,v)=>{ if(v==null)return""; const t=Array.isArray(v)?v.join("、"):nb(v); if(!t)return"";
  return `<tr><th style="text-align:left;width:180px;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;white-space:nowrap;">${k}</th><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#111827;">${t}</td></tr>`; };
const section=(title,rows)=>{ if(!rows||!nb(rows))return"";
  return `<div style="margin:18px 0;padding:14px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;"><h3 style="margin:0 0 10px;font-size:16px;color:#2563eb;">${title}</h3><table style="border-collapse:collapse;width:100%;">${rows}</table></div>`; };

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

// ---------- Email HTML ----------
function buildEmailHtml(p, pdfUrl){
  const KNOWN=["平日","假日","上午","下午","晚上","皆可"];
  const timeslot = sortKnownFirst(toArr(p.timeslot).concat(nb(p.timeslot_other)||nb(p.time_other)?[`其他指定時間：${nb(p.timeslot_other)||nb(p.time_other)}`]:[]), KNOWN);
  const contactPref = sortKnownFirst(toArr(p.contact_time_preference).concat(nb(p.contact_time_preference_other)?[`其他指定時間：${nb(p.contact_time_preference_other)}`]:[]), KNOWN);

  const service=[
    tr("服務類別",p.service_category),
    tr("冷氣類型",p.ac_type),
    tr("清洗數量",p.ac_count),
    tr("室內機所在樓層",p.indoor_floor),
    tr("冷氣品牌",p.ac_brand),
    tr("是否為變形金剛系列",p.ac_transformer_series)
  ].join("");

  const addon=[ tr("冷氣防霉抗菌處理",p.anti_mold?"需要":""), tr("臭氧空間消毒",p.ozone?"需要":"") ].join("");

  const otherSvc=[
    tr("直立式洗衣機台數",p.washer_count),
    tr("洗衣機樓層",Array.isArray(p.washer_floor)?p.washer_floor.join("、"):p.washer_floor),
    tr("自來水管清洗",p.pipe_service),
    tr("水管清洗原因",p.pipe_reason),
    tr("水塔清洗台數",p.tank_count)
  ].join("");

  const contact=[
    tr("與我們聯繫方式",p.contact_method),
    tr("LINE 或 Facebook 名稱",p.line_or_fb)
  ].join("");

  const booking=[
    tr("可安排時段",timeslot),
    tr("方便聯繫時間",contactPref),
    tr("顧客姓名",p.customer_name),
    tr("聯繫電話",p.phone),
    tr("清洗保養地址",p.address),
    tr("居住地型態",p.house_type||p.housing_type),
    tr("其他備註說明",p.note)
  ].join("");

  const link = pdfUrl ? `<p style="margin:10px 0 0">PDF 檔案連結：<a href="${pdfUrl}" target="_blank" rel="noreferrer">${pdfUrl}</a></p>` : "";

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;background:#ffffff;color:#111827;">
    ${section("服務資訊",service)}
    ${addon.trim()?section("防霉・消毒｜加購服務專區",addon):""}
    ${otherSvc.trim()?section("其他清洗服務",otherSvc):""}
    ${section("聯繫名稱說明",contact)}
    ${section("預約資料填寫",booking)}
    ${link}
  </div>`;
}

// ---------- 字型 ----------
async function loadChineseFontBytes() {
  const fontPath = path.join(__dirname, "fonts", "NotoSansTC-Regular.otf");
  if (!fs.existsSync(fontPath)) throw new Error(`字型檔不存在：${fontPath}`);
  return fs.readFileSync(fontPath);
}

// ---------- 產生 PDF ----------
async function buildPdfBuffer(p){
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
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

  draw("新預約單", { size: 16 });
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
  addRow("LINE 或 Facebook 名稱", p.line_or_fb);
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

// ---------- Cloudinary ----------
function makePublicId(p){
  const seed = [p.customer_name||"", p.phone||"", p.address||"", p.service_category||"", Date.now()].join("|");
  const h = crypto.createHash("sha1").update(seed).digest("hex").slice(0,12);
  return `booking_${h}`;
}
function cloudinarySign(params, apiSecret){
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + apiSecret;
  return crypto.createHash("sha1").update(toSign).digest("hex");
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try{
    const p = parseBody(event);

    // 欄位正規化：確保 LINE/FB 名稱能被讀到
    p.customer_name = p.customer_name || p.name;
    p.line_or_fb =
      p.line_or_fb ||
      p.social_name ||
      p.line_facebook_name ||
      p.line_name ||
      p.facebook_name ||
      p.line ||
      p.facebook;

    // 先上傳 Cloudinary，取得 PDF URL
    let pdfUrl = "";
    const cloud = nb(process.env.CLOUDINARY_CLOUD_NAME);
    const apiKey = nb(process.env.CLOUDINARY_API_KEY);
    const apiSecret = nb(process.env.CLOUDINARY_API_SECRET);
    if (cloud && apiKey && apiSecret){
      const pdf = await buildPdfBuffer(p);
      const public_id = makePublicId(p) + "_booking.pdf";
      const timestamp = Math.floor(Date.now()/1000);
      const tags = ["reservation", nb(p.service_category)].filter(Boolean).join(",");

// 構建 context（摘要欄位：name/phone/service/address/area/source）
const ctxPairs = {
  name: p.customer_name || p.name || "",
  phone: p.phone || "",
  service: p.service_category || p.service_item || p.select_service || "",
  address: p.address || "",
  area: p.area || p.city || p.region || "",
  source: p.subject || p.page_title || p.page || ""
};
const context = Object.entries(ctxPairs)
  .filter(([k,v]) => v && String(v).trim() !== "")
  .map(([k,v]) => `${k}=${String(v).replace(/\|/g, "/")}`) // Cloudinary context 用 | 分隔，內容若含 | 先替換
  .join("|");

// 產生簽名（需包含 context）
const signParams = context ? { public_id, timestamp, tags, context } : { public_id, timestamp, tags };
const signature = cloudinarySign(signParams, apiSecret);
const fileDataURI = `data:application/pdf;base64,${pdf.toString('base64')}`;
      const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ file: fileDataURI, public_id, api_key: apiKey, timestamp, signature, tags }, context ? { context } : {}))
      });
      if (up.ok){
        const result = await up.json();
        pdfUrl = result.secure_url || result.url || "";
      }
    }

    // Email via Brevo
    const subject = `${process.env.EMAIL_SUBJECT_PREFIX || ""}${p.subject || "預約來了！"}`;
    const html = buildEmailHtml(p, pdfUrl);
    const toList = String(process.env.EMAIL_TO || "").split(",").map(s=>s.trim()).filter(Boolean).map(email=>({ email }));
    if (!toList.length) throw new Error("EMAIL_TO 未設定");

    const senderEmail = nb(process.env.EMAIL_FROM);
    const senderId = nb(process.env.BREVO_SENDER_ID);
    if (!senderEmail && !senderId) throw new Error("Missing EMAIL_FROM or BREVO_SENDER_ID");
    const sender = senderEmail ? { email: senderEmail } : { id: Number(senderId) };

    const mailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": nb(process.env.BREVO_API_KEY), "content-type":"application/json" },
      body: JSON.stringify({ sender, to: toList, subject, htmlContent: html, tags:["reservation"] })
    });
    if (!mailRes.ok) throw new Error(`Brevo ${mailRes.status}: ${await mailRes.text()}`);
    // --- Capture Brevo Message ID robustly ---
    let brevoJson = null;
    let brevoMsgId = null;
    try { brevoJson = await mailRes.json(); } catch(_e){ /* some Brevo responses may be 204 or no JSON */ }
    if (brevoJson) {
      brevoMsgId = brevoJson.messageId || brevoJson["message-id"] || null;
      console.log("Brevo Response:", brevoJson);
    }
    if (!brevoMsgId) {
      // try common header names
      try {
        brevoMsgId = mailRes.headers.get("message-id")
          || mailRes.headers.get("x-message-id")
          || mailRes.headers.get("sib-message-id")
          || null;
      } catch(_e){}
    }
    console.log("Brevo Message ID (captured):", brevoMsgId);

    // --- Write messageId back into Cloudinary context (non-fatal) ---
    try {
      if (brevoMsgId && cloud && apiKey && apiSecret && public_id) {
        const ts_ctx = Math.floor(Date.now() / 1000);
        const parts_ctx = (context || "").split("|").filter(Boolean);
        for (let i = parts_ctx.length - 1; i >= 0; i--) {
          if (parts_ctx[i].startsWith("brevo_msg_id=")) parts_ctx.splice(i, 1);
        }
        parts_ctx.push("brevo_msg_id=" + String(brevoMsgId).replace(/\|/g, "/"));
        const newCtx = parts_ctx.join("|");
        const signParamsCtx = { public_id, timestamp: ts_ctx, tags, context: newCtx };
        const sigCtx = cloudinarySign(signParamsCtx, apiSecret);
        await fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: fileDataURI,
            public_id,
            api_key: apiKey,
            timestamp: ts_ctx,
            signature: sigCtx,
            tags,
            context: newCtx
          })
        });
        console.log('Updated Cloudinary context with brevo_msg_id for', public_id);
      } else {
        console.log('Skip context update: missing msgId or Cloudinary creds/public_id');
      }
    } catch (e) {
      console.log('Failed to update brevo_msg_id to Cloudinary context:', e && e.message ? e.message : String(e));
    }


    return { statusCode: 200, body: JSON.stringify({ ok:true, email:"sent", pdf_url: pdfUrl }) };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: String((err && err.message) || err) }) };
  }
};

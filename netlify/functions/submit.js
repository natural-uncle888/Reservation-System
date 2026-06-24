
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
    ac_transformer_count: __pick(p, ["ac_transformer_count","變形金剛系列台數"]),
    ac_transformer_unknown: __pick(p, ["ac_transformer_unknown","變形金剛系列是否不清楚"]),
    // 加購/其他
    antifungus: __pick(p, ["antifungus","冷氣防霉抗菌處理","anti_mold"]),
    ozone: __pick(p, ["ozone","臭氧殺菌消毒"]),
    ozone_room_count: __pick(p, ["ozone_room_count","臭氧消毒房間數"]),
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
const { loadNotificationSettings, canSendBrevoEmail, canSendLinePush } = require("./notification-utils");

const nb = v => (v == null ? "" : String(v)).trim();
const toArr = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);

// 通知設定工具由 notification-utils.js 共用。

function getContentType(event){
  const h = event.headers || {};
  return h["content-type"] || h["Content-Type"] || "";
}

function parseMultipart(event, contentType){
  const boundaryMatch = String(contentType || "").match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  if (!boundaryMatch) return { fields: {}, files: [] };
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const bodyBuffer = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "binary");
  const boundaryBuffer = Buffer.from("--" + boundary);
  const fields = {};
  const files = [];
  let cursor = bodyBuffer.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    cursor += boundaryBuffer.length;
    if (bodyBuffer.slice(cursor, cursor + 2).toString() === "--") break;
    if (bodyBuffer.slice(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const next = bodyBuffer.indexOf(boundaryBuffer, cursor);
    if (next === -1) break;
    let part = bodyBuffer.slice(cursor, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString("utf8");
      const content = part.slice(headerEnd + 4);
      const disp = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
      if (disp) {
        const nameMatch = disp[1].match(/name="([^"]+)"/i);
        const filenameMatch = disp[1].match(/filename="([^"]*)"/i);
        const name = nameMatch && nameMatch[1];
        const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
        if (name && filenameMatch && filenameMatch[1]) {
          files.push({
            fieldname: name,
            filename: filenameMatch[1],
            mimetype: typeMatch ? typeMatch[1].trim().toLowerCase() : "application/octet-stream",
            buffer: content,
            size: content.length,
          });
        } else if (name) {
          fields[name] = content.toString("utf8");
        }
      }
    }
    cursor = next;
  }
  return { fields, files };
}

function parseBody(event){
  const contentType = getContentType(event);
  const ct=contentType.split(";")[0].trim().toLowerCase();
  if(ct==="multipart/form-data"){
    const parsed = parseMultipart(event, contentType);
    let data = {};
    if (parsed.fields.data) {
      try { data = JSON.parse(parsed.fields.data); } catch { data = {}; }
    } else {
      data = parsed.fields || {};
    }
    return { data, files: parsed.files.filter(f => f.fieldname === "photos") };
  }
  if(ct==="application/json"||!ct){ try{return { data: JSON.parse(event.body||"{}"), files: [] };}catch{return { data:{}, files: [] };} }
  if(ct==="application/x-www-form-urlencoded"){
    const params=new URLSearchParams(event.body||""); const obj={};
    for(const[k,v]of params.entries())obj[k]=v; return { data: obj, files: [] };
  }
  return { data: {}, files: [] };
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

function escapeHtml(value){
  return nb(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSiteBaseUrl(){
  return nb(process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL).replace(/\/$/, "");
}

function buildLineReplyText(p, opts = {}){
  const serviceName = nb(p.service_category || p.service || "預約服務");
  const name = nb(p.customer_name || p.name);
  const phone = nb(p.phone);
  const address = nb(p.address);
  const area = nb(p.area || p.city || "");
  const timeslotText = nb(opts.timeslotText || p.timeslot);

  const details = [];
  if (serviceName) details.push(`服務項目：${serviceName}`);
  if (nb(p.ac_type)) details.push(`冷氣類型：${nb(p.ac_type)}`);
  if (nb(p.ac_count)) details.push(`清洗數量：${nb(p.ac_count)}`);

  // 冷氣特殊機型與加購明細：LINE 回覆文字需與信件詳細資料一致。
  const transformerCountText = nb(p.ac_transformer_count);
  const transformerCount = Number(transformerCountText || 0);
  const transformerUnknown = toArr(p.ac_transformer_unknown || p.ac_transformer_series).map(nb).filter(Boolean).join("、");
  if (transformerCountText) details.push(`變形金剛系列台數：${transformerCount} 台`);
  if (transformerUnknown) details.push(`變形金剛系列是否不清楚：${transformerUnknown}`);

  const hasAntiMold = toArr(p.anti_mold || p.antifungus).map(nb).filter(Boolean).length > 0;
  const hasOzone = toArr(p.ozone).map(nb).filter(Boolean).length > 0;
  const acCount = Number(nb(p.ac_count) || 0);
  const ozoneRoomCountText = nb(p.ozone_room_count);
  const ozoneRoomCount = Number(ozoneRoomCountText || 0);
  if (hasAntiMold) details.push(`冷氣防霉抗菌處理：需要${acCount > 0 ? `（${acCount} 台）` : ""}`);
  if (hasOzone) {
    details.push("臭氧空間消毒：需要");
    details.push(`臭氧消毒房間數：${ozoneRoomCount > 0 ? `${ozoneRoomCount} 間` : "待確認"}`);
  }

  if (nb(p.washer_count)) details.push(`直立式洗衣機：${nb(p.washer_count)}`);
  if (nb(p.tank_count)) details.push(`水塔：${nb(p.tank_count)}`);
  if (nb(p.pipe_service)) details.push(`自來水管清洗：${nb(p.pipe_service)}`);
  if (area) details.push(`地區：${area}`);
  if (address) details.push(`地址：${address}`);
  if (timeslotText) details.push(`可安排時段：${timeslotText}`);
  if (phone) details.push(`聯繫電話：${phone}`);

  const lines = [
    "您好，我們已收到您的預約需求，謝謝您。",
    ""
  ];

  if (name) {
    lines.push(`預約人：${name}`, "");
  }

  return [
    ...lines,
    "您填寫的預約內容如下：",
    ...details,
    "",
    "我們會再協助確認服務內容與可安排時段，並於 1～3 個工作日內回覆您，謝謝。"
  ].join("\n");
}

function buildLineReplySection(p, timeslotText){
  const replyText = buildLineReplyText(p, { timeslotText });
  const siteBaseUrl = getSiteBaseUrl();
  const copyUrl = siteBaseUrl
    ? `${siteBaseUrl}/line-reply.html?text=${encodeURIComponent(replyText)}`
    : "";

  return `<div style="margin:18px 0 0;padding:16px;border:2px solid #16a34a;border-radius:12px;background:#f0fdf4;">
    <div style="font-size:15px;font-weight:700;color:#15803d;margin-bottom:8px;">可複製 LINE 回覆文字</div>
    <div style="font-size:12px;color:#4b5563;line-height:1.6;margin-bottom:10px;">
      可直接複製下方文字貼到 LINE 回覆客人。${copyUrl ? "若要使用一鍵複製，請點下方按鈕開啟複製頁。" : ""}
    </div>
    ${copyUrl ? `<div style="margin:0 0 12px;"><a href="${copyUrl}" target="_blank" rel="noopener" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 14px;border-radius:8px;">開啟一鍵複製頁</a></div>` : ""}
    <div style="padding:12px;border:1px solid #bbf7d0;border-radius:10px;background:#ffffff;color:#111827;font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word;">${escapeHtml(replyText)}</div>
  </div>`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = nb(value);
    if (text) return text;
  }
  return "";
}

function isMeaningfulLineValue(value) {
  const text = nb(value);
  if (!text) return false;
  return !/^(不需要|否|無|沒有|未選擇|false|0|no|null|undefined)$/i.test(text);
}

function hasSelectedLineOption(value) {
  return toArr(value).map(nb).some(isMeaningfulLineValue);
}

function appendUnitIfNeeded(value, unit) {
  const text = nb(value).replace(/\s+/g, "");
  if (!text) return "";
  return text.includes(unit) ? text : `${text}${unit}`;
}

function buildAdminLineNotificationText(p, pdfUrl) {
  const lines = ["自然大叔｜新預約通知", ""];

  const serviceName = firstNonEmpty(p.service_category, p.service, p.service_item);
  const acType = firstNonEmpty(p.ac_type, p.ac_kind, p.type);
  const acCount = firstNonEmpty(p.ac_count_other, p.ac_count, p.count, p.quantity);
  const washerCount = firstNonEmpty(p.washer_count);
  const tankCount = firstNonEmpty(p.tank_count);
  const pipeService = firstNonEmpty(p.pipe_service);
  const name = firstNonEmpty(p.customer_name, p.name);
  const phone = firstNonEmpty(p.phone, p.phone_number, p.mobile, p.tel);
  const address = firstNonEmpty(p.address);
  const timeslot = firstNonEmpty(
    p.timeslot,
    p.time_slot,
    p.available_time,
    p.availableTime,
    p.preferred_time,
    p.contact_time_preference
  );

  if (serviceName) lines.push(`服務項目：${serviceName}`);
  if (acType) lines.push(`冷氣類型：${acType}`);
  if (acCount) lines.push(`冷氣台數：${appendUnitIfNeeded(acCount, "台")}`);

  const hasAntiMold = hasSelectedLineOption(p.anti_mold || p.antifungus);
  const hasOzone = hasSelectedLineOption(p.ozone);
  const ozoneRoomCount = firstNonEmpty(p.ozone_room_count);

  if (hasAntiMold || hasOzone || washerCount || tankCount || pipeService) {
    lines.push("");
  }

  if (hasAntiMold) lines.push("防霉抗菌：需要");
  if (hasOzone) {
    lines.push(`臭氧消毒：需要${ozoneRoomCount ? `（${appendUnitIfNeeded(ozoneRoomCount, "間")}）` : ""}`);
  }
  if (washerCount) lines.push(`洗衣機：${appendUnitIfNeeded(washerCount, "台")}`);
  if (tankCount) lines.push(`水塔：${appendUnitIfNeeded(tankCount, "顆")}`);
  if (pipeService) lines.push(`水管清洗：${pipeService}`);

  if (name || phone || address || timeslot) {
    lines.push("");
  }

  if (name) lines.push(`姓名：${name}`);
  if (phone) lines.push(`電話：${phone}`);
  if (address) lines.push(`清洗地址：${address}`);
  if (timeslot) lines.push(`可安排時段：${timeslot}`);

  const message = lines.filter((line, index, arr) => {
    // 避免連續多個空行，也避免最後一行是空行。
    if (line !== "") return true;
    return index > 0 && index < arr.length - 1 && arr[index - 1] !== "" && arr[index + 1] !== "";
  }).join("\n");

  // LINE 文字訊息上限為 5000 字；保守截斷避免推播失敗。
  return message.length > 4800 ? message.slice(0, 4790) + "\n...(內容過長已截斷)" : message;
}

async function sendLineNotification(message) {
  const token = nb(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  const userId = nb(process.env.LINE_ADMIN_USER_ID);

  if (!token || !userId) {
    console.warn("LINE notification skipped: missing LINE_CHANNEL_ACCESS_TOKEN or LINE_ADMIN_USER_ID");
    return { ok: false, reason: "missing_line_env" };
  }

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text: message }]
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("LINE notification failed:", res.status, errorText);
      return { ok: false, status: res.status, error: errorText };
    }

    return { ok: true };
  } catch (err) {
    console.error("LINE notification error:", err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}


function buildEmailHtml(p, pdfUrl){
  const KNOWN = ["平日","假日","上午","下午","晚上","皆可"];

  // ---- 可安排時段 / 聯繫時間（整理成好讀文字） ----
  const timeslotList = sortKnownFirst(
    []
      .concat(toArr(p.timeslot))
      .concat(
        (nb(p.timeslot_other) || nb(p.time_other))
          ? [`其他指定時間：${nb(p.timeslot_other) || nb(p.time_other)}`]
          : []
      ),
    KNOWN
  );
  const timeslotText = Array.isArray(timeslotList) ? timeslotList.join("、") : timeslotList;

  const contactPrefList = sortKnownFirst(
    []
      .concat(toArr(p.contact_time_preference))
      .concat(
        nb(p.contact_time_preference_other)
          ? [`其他指定時間：${nb(p.contact_time_preference_other)}`]
          : []
      ),
    KNOWN
  );
  const contactPrefText = Array.isArray(contactPrefList) ? contactPrefList.join("、") : contactPrefList;

  const serviceName = nb(p.service_category || p.service || "");
  const isAC    = serviceName === "冷氣清洗";
  const isOther = serviceName === "其他保養清洗";
  const isGroup = serviceName === "團購預約清洗";
  const isBulk  = serviceName === "大量清洗需求";

  // ---- 小工具：行 & 區塊 ----
  const makeRow = (label, value) => {
    if (value == null) return "";
    const t = Array.isArray(value)
      ? toArr(value).map(nb).filter(Boolean).join("、")
      : nb(value);
    if (!t) return "";
    return `<div style="margin-bottom:8px;">
      <div style="font-size:12px;color:#6b7280;line-height:1.4;">${label}</div>
      <div style="font-size:14px;color:#111827;line-height:1.7;word-break:break-word;white-space:pre-wrap;">${t}</div>
    </div>`;
  };

  const makeSection = (title, innerHtml) => {
    if (!innerHtml || !nb(innerHtml)) return "";
    return `<div style="margin:0 0 16px;padding:14px 14px 12px;border-radius:12px;border:1px solid #e5e7eb;background:#f9fafb;">
      <div style="font-size:13px;font-weight:600;color:#1d4ed8;margin-bottom:8px;">${title}</div>
      ${innerHtml}
    </div>`;
  };

  // ---- 重要摘要（依服務類別客製欄位） ----
  let summaryRows = "";

  if (isAC) {
    summaryRows += makeRow("冷氣類型", p.ac_type);
    summaryRows += makeRow("清洗數量", p.ac_count);
    summaryRows += makeRow("顧客姓名", p.customer_name || p.name);
    summaryRows += makeRow("可安排時段", timeslotText);
  } else if (isOther) {
    // 清洗台數(直立式洗衣機、水塔)
    const washer = nb(p.washer_count);
    const tank = nb(p.tank_count);
    let countText = "";
    const parts = [];
    if (washer) parts.push(`直立式洗衣機 ${washer}`);
    if (tank) parts.push(`水塔 ${tank}`);
    if (parts.length) countText = parts.join("／");

    summaryRows += makeRow("服務類別", serviceName || "其他保養清洗");
    summaryRows += makeRow("清洗台數", countText);
    summaryRows += makeRow("顧客姓名", p.customer_name || p.name);
    summaryRows += makeRow("可安排時段", timeslotText);
  } else if (isGroup) {
    summaryRows += makeRow("服務類別", serviceName || "團購預約清洗");
    summaryRows += makeRow("顧客姓名", p.customer_name || p.name);
  } else if (isBulk) {
    summaryRows += makeRow("服務類別", serviceName || "大量清洗需求");
    summaryRows += makeRow("顧客姓名", p.customer_name || p.name);
  } else {
    // 萬一沒有正確帶到服務類別，就用保底欄位
    summaryRows += makeRow("服務類別", serviceName || "未填寫");
    summaryRows += makeRow("顧客姓名", p.customer_name || p.name);
    summaryRows += makeRow("可安排時段", timeslotText);
  }

  const summarySection = makeSection("重要摘要（請優先查看）", summaryRows);

  // ---- 服務資訊 ----
  const serviceRows = [
    makeRow("服務類別", serviceName),
    makeRow("冷氣類型", p.ac_type),
    makeRow("清洗數量", p.ac_count),
    makeRow("室內機所在樓層", p.indoor_floor),
    makeRow("冷氣品牌", p.ac_brand),
    makeRow("變形金剛系列台數", p.ac_transformer_count),
    makeRow("變形金剛系列是否不清楚", p.ac_transformer_unknown || p.ac_transformer_series)
  ].join("");

  // ---- 加購服務 ----
  const addonRows = [
    makeRow("冷氣防霉抗菌處理", p.anti_mold ? "需要" : ""),
    makeRow("臭氧空間消毒", p.ozone ? "需要" : ""),
    makeRow("臭氧消毒房間數", p.ozone ? p.ozone_room_count : "")
  ].join("");

  // ---- 其他清洗服務（洗衣機／水塔／水管） ----
  const otherServiceRows = [
    makeRow("直立式洗衣機台數", p.washer_count),
    makeRow("洗衣機樓層", Array.isArray(p.washer_floor) ? p.washer_floor.join("、") : p.washer_floor),
    makeRow("自來水管清洗", p.pipe_service),
    makeRow("水管清洗原因", p.pipe_reason),
    makeRow("水塔清洗台數", p.tank_count)
  ].join("");

  // ---- 團購／大量需求說明（手動輸入） ----
  const groupNotes = nb(p.group_notes);
  const bulkNotes  = nb(p.bulk_notes);

  const groupSection = groupNotes
    ? makeSection("團購預約說明", makeRow("說明內容", groupNotes))
    : "";

  const bulkSection = bulkNotes
    ? makeSection("大量需求說明", makeRow("說明內容", bulkNotes))
    : "";

  // ---- 聯繫資料 ----
  const contactRows = [
    makeRow("顧客姓名", p.customer_name || p.name),
    makeRow("聯繫電話", p.phone),
    makeRow("與我們聯繫方式", p.contact_method),
    makeRow("聯繫帳號／名稱", p.line_or_fb),
    makeRow("其他聯繫說明", p.other_contact_detail)
  ].join("");

  // ---- 預約詳細資料 ----
  const bookingRows = [
    makeRow("可安排時段", timeslotText),
    makeRow("方便聯繫時間", contactPrefText),
    makeRow("清洗保養地址", p.address),
    makeRow("居住地型態", p.house_type || p.housing_type),
    makeRow("其他備註說明", p.note)
  ].join("");

  // ---- 信件標題用的小標資訊 ----
  const titleService = serviceName || "新預約";
  const titleName = nb(p.customer_name || p.name);
  const titleArea = nb(p.area || p.city);

  const subtitleParts = [];
  if (titleName) subtitleParts.push(titleName);
  if (titleArea) subtitleParts.push(titleArea);
  const subtitle = subtitleParts.join("｜");

  // ---- 最終信件 HTML（手機優先，一欄式） ----
  return `
  <div style="margin:0;padding:16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <!-- Header -->
      <div style="padding:16px 18px 14px;background:#111827;color:#f9fafb;">
        <div style="font-size:17px;font-weight:600;letter-spacing:0.03em;">
          自然大叔｜${titleService} 預約通知
        </div>
        ${subtitle ? `<div style="margin-top:4px;font-size:13px;color:#e5e7eb;">${subtitle}</div>` : ""}
        <div style="margin-top:6px;font-size:11px;color:#9ca3af;line-height:1.5;">
          這封信來自線上預約表單，請依下方資訊安排聯繫與服務。
        </div>
      </div>

      <!-- Body -->
      <div style="padding:18px 16px 20px;">
        ${summarySection}
        ${makeSection("服務資訊", serviceRows)}
        ${addonRows.trim() ? makeSection("防霉・消毒｜加購服務專區", addonRows) : ""}
        ${otherServiceRows.trim() ? makeSection("其他清洗服務", otherServiceRows) : ""}
        ${groupSection}
        ${bulkSection}
        ${makeSection("聯繫資料", contactRows)}
        ${makeSection("預約詳細資料", bookingRows)}
        ${(Array.isArray(p.site_photo_urls) && p.site_photo_urls.length) ? makeSection("現場照片", p.site_photo_urls.map((url, idx) => `<div style="margin:8px 0;"><a href="${url}" target="_blank" rel="noopener">照片 ${idx + 1}</a></div>`).join("")) : ""}
        ${buildLineReplySection(p, timeslotText)}
      </div>

      <!-- Footer -->
      <div style="padding:10px 18px 12px;border-top:1px solid #e5e7eb;font-size:11px;line-height:1.6;color:#9ca3af;background:#f9fafb;">
        <div>※ 本信件由系統自動發送，請直接依後台或既有流程處理預約，不需回信給顧客。</div>
        <div>※ 如需查詢或歸檔，可使用 Cloudinary 中的 PDF 或後台列表查看完整內容。</div>
      </div>
    </div>
  </div>
  `;
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
  addRow("變形金剛系列台數", p.ac_transformer_count);
  addRow("變形金剛系列是否不清楚", p.ac_transformer_unknown || p.ac_transformer_series);
  addRow("防霉抗菌", p.anti_mold ? "需要" : "");
  addRow("臭氧消毒", p.ozone ? "需要" : "");
  addRow("臭氧消毒房間數", p.ozone ? p.ozone_room_count : "");
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
  addRow("現場照片", Array.isArray(p.site_photo_urls) ? p.site_photo_urls.join("、") : p.site_photo_urls);

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

function cloudinaryContextValue(value){
  if (value == null || String(value).trim() === "") return "";
  const normalized = (typeof value === "object")
    ? encodeURIComponent(JSON.stringify(value))
    : String(value).trim();
  // Cloudinary context uses | and = as separators; user input must not break the record.
  return normalized.replace(/\|/g, "/").replace(/=/g, "＝");
}

function clippedContextValue(value){
  // Cloudinary contextual metadata 每個值有長度限制；保留後台足夠顯示的安全長度。
  return cloudinaryContextValue(value).slice(0, 240);
}

function buildBookingAssetContext(p, minimal = false){
  // Cloudinary context 僅保存後台查詢與出勤所需的短欄位；
  // PDF 與 Email 仍保留完整預約明細，避免長 JSON/網址讓整筆 context 寫入失敗。
  const standardKeys = [
    "customer_name", "phone", "service_category", "address", "area", "subject",
    "ac_type", "ac_count", "indoor_floor", "ac_brand",
    "ac_transformer_count", "ac_transformer_unknown",
    "anti_mold", "ozone", "ozone_room_count",
    "washer_count", "washer_floor", "tank_count", "pipe_service", "pipe_reason",
    "contact_method", "social_name", "line_or_fb", "other_contact_detail", "housing_type", "contact_time_preference",
    "timeslot", "time_other", "note", "group_notes", "bulk_notes", "service_description",
    "site_photo_count", "storage_warning"
  ];
  const fallbackKeys = [
    "customer_name", "phone", "service_category", "address", "area", "subject",
    "ac_type", "ac_count", "indoor_floor", "ac_brand",
    "ac_transformer_count", "ac_transformer_unknown",
    "anti_mold", "ozone", "ozone_room_count",
    "timeslot", "site_photo_count", "storage_warning"
  ];
  const keys = minimal ? fallbackKeys : standardKeys;
  const entries = keys.map(key => [key, p[key]]);

  // 不把整組網址 JSON 塞入單一 context value；每張照片分開保存以避免超長。
  if (!minimal && Array.isArray(p.site_photo_urls)) {
    p.site_photo_urls.slice(0, 5).forEach((url, index) => {
      entries.push([`site_photo_url_${index + 1}`, url]);
    });
  }

  return entries
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key, value]) => `${key}=${clippedContextValue(value)}`)
    .join("|");
}

async function uploadBookingPdfToCloudinary({ cloud, apiKey, apiSecret, pdf, public_id, tags, context }){
  const timestamp = Math.floor(Date.now()/1000);
  const signParams = context ? { public_id, timestamp, tags, context } : { public_id, timestamp, tags };
  const signature = cloudinarySign(signParams, apiSecret);
  const fileDataURI = `data:application/pdf;base64,${pdf.toString("base64")}`;
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign(
      { file: fileDataURI, public_id, api_key: apiKey, timestamp, signature, tags },
      context ? { context } : {}
    ))
  });
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const reason = result && result.error && result.error.message ? result.error.message : `HTTP ${resp.status}`;
    throw new Error(`Cloudinary 預約檔上傳失敗：${reason}`);
  }
  return result.secure_url || result.url || "";
}

async function uploadImageToCloudinary({ cloud, apiKey, apiSecret, file, public_id, tags }){
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.mimetype)) throw new Error("照片格式僅支援 JPG、PNG、WebP");
  if (file.size > 5 * 1024 * 1024) throw new Error("單張照片不可超過 5MB");
  const timestamp = Math.floor(Date.now()/1000);
  const params = { public_id, timestamp, tags };
  const signature = cloudinarySign(params, apiSecret);
  const ext = file.mimetype === "image/png" ? "png" : (file.mimetype === "image/webp" ? "webp" : "jpeg");
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const fd = new FormData();
  fd.append("file", dataUri);
  fd.append("public_id", public_id);
  fd.append("api_key", apiKey);
  fd.append("timestamp", String(timestamp));
  fd.append("signature", signature);
  fd.append("tags", tags);
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: fd });
  if (!resp.ok) throw new Error(`Cloudinary image upload failed: ${resp.status} ${await resp.text()}`);
  const result = await resp.json();
  return result.secure_url || result.url || "";
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try{
    const parsedBody = parseBody(event);
    const p = parsedBody.data || {};
    const photoFiles = parsedBody.files || [];
    if (photoFiles.length > 5) throw new Error("最多只能上傳 5 張照片");

    // 讀取後台通知設定；讀取失敗時使用預設開啟，避免影響既有接單流程。
    const notificationSettings = await loadNotificationSettings();

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
      const bookingBasePublicId = makePublicId(p);
      const tags = ["reservation", nb(p.service_category)].filter(Boolean).join(",");
      const photoUrls = [];
      for (let i = 0; i < photoFiles.length; i++) {
        const url = await uploadImageToCloudinary({
          cloud,
          apiKey,
          apiSecret,
          file: photoFiles[i],
          public_id: `${bookingBasePublicId}_photo_${i + 1}`,
          tags: [tags, "booking-photo"].filter(Boolean).join(",")
        });
        if (url) photoUrls.push(url);
      }
      if (photoUrls.length) {
        p.site_photo_urls = photoUrls;
        p.site_photo_count = String(photoUrls.length);
      }
      const pdf = await buildPdfBuffer(p);
      const public_id = bookingBasePublicId + "_booking.pdf";
      const fullContext = buildBookingAssetContext(p);
      try {
        pdfUrl = await uploadBookingPdfToCloudinary({
          cloud, apiKey, apiSecret, pdf, public_id, tags, context: fullContext
        });
      } catch (fullContextError) {
        // 若完整明細仍發生例外，使用包含接單關鍵欄位的備援資料，並讓後台可辨識此狀態。
        p.storage_warning = "完整明細儲存失敗，已改以關鍵資料建立預約紀錄；請以信件或 PDF 補核對明細。";
        const fallbackContext = buildBookingAssetContext(p, true);
        try {
          pdfUrl = await uploadBookingPdfToCloudinary({
            cloud, apiKey, apiSecret, pdf, public_id, tags, context: fallbackContext
          });
        } catch (fallbackError) {
          throw new Error(`${fullContextError.message}；基本資料備援上傳亦失敗：${fallbackError.message}`);
        }
      }
    }

    // Email via Brevo
    // 通知失敗不應該讓預約提交失敗，避免客人重複送單、後台產生重複資料。
    let emailStatus = "not_sent";
    let emailError = "";
    const emailGate = canSendBrevoEmail(notificationSettings, "newBookingEmailEnabled");
    if (!emailGate.ok) {
      emailStatus = "skipped";
      emailError = emailGate.reason;
      console.info(emailError);
    } else try {
      const subject = `${process.env.EMAIL_SUBJECT_PREFIX || ""}${p.subject || "預約來了！"}`;
      const html = buildEmailHtml(p, pdfUrl);
      const toList = String(process.env.EMAIL_TO || "").split(",").map(s=>s.trim()).filter(Boolean).map(email=>({ email }));
      const senderEmail = nb(process.env.EMAIL_FROM);
      const senderId = nb(process.env.BREVO_SENDER_ID);
      const brevoApiKey = nb(process.env.BREVO_API_KEY);

      if (!brevoApiKey) {
        emailStatus = "skipped";
        emailError = "BREVO_API_KEY 未設定";
        console.warn(emailError);
      } else if (!toList.length) {
        emailStatus = "skipped";
        emailError = "EMAIL_TO 未設定";
        console.warn(emailError);
      } else if (!senderEmail && !senderId) {
        emailStatus = "skipped";
        emailError = "EMAIL_FROM 或 BREVO_SENDER_ID 未設定";
        console.warn(emailError);
      } else {
        const sender = senderEmail ? { email: senderEmail } : { id: Number(senderId) };
        const mailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoApiKey, "content-type":"application/json" },
          body: JSON.stringify({ sender, to: toList, subject, htmlContent: html, tags:["reservation"] })
        });

        if (!mailRes.ok) {
          emailStatus = "failed";
          emailError = `Brevo ${mailRes.status}: ${await mailRes.text()}`;
          console.error(emailError);
        } else {
          emailStatus = "sent";
        }
      }
    } catch (mailErr) {
      emailStatus = "failed";
      emailError = String((mailErr && mailErr.message) || mailErr);
      console.error("Brevo unexpected error:", mailErr);
    }

    // LINE 新預約通知
    let lineStatus = "not_sent";
    let lineError = "";
    const lineGate = canSendLinePush(notificationSettings, "newBookingLineEnabled");
    if (!lineGate.ok) {
      lineStatus = "skipped";
      lineError = lineGate.reason;
      console.info(lineError);
    } else try {
      const lineMessage = buildAdminLineNotificationText(p, pdfUrl);
      const lineResult = await sendLineNotification(lineMessage);
      lineStatus = lineResult.ok ? "sent" : "failed";
      if (!lineResult.ok) {
        lineError = lineResult.error || lineResult.reason || `LINE status ${lineResult.status || "unknown"}`;
      }
    } catch (lineErr) {
      lineStatus = "failed";
      lineError = String((lineErr && lineErr.message) || lineErr);
      console.error("LINE notification unexpected error:", lineErr);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        email: emailStatus,
        emailStatus,
        lineStatus,
        emailError,
        lineError,
        notificationSettings,
        pdf_url: pdfUrl,
        photo_urls: p.site_photo_urls || []
      })
    };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: String((err && err.message) || err) }) };
  }
};

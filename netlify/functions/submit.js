// netlify/functions/submit.js — send only on final step; plain text; Cloudinary idempotent
import crypto from "node:crypto";

function parseBody(event) {
  const ct = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();
  if (ct.includes("application/json")) { try { return JSON.parse(event.body || "{}"); } catch { return {}; } }
  if (ct.includes("application/x-www-form-urlencoded")) { return Object.fromEntries(new URLSearchParams(event.body || "")); }
  try { return JSON.parse(event.body || "{}"); } catch { return {}; }
}

function textFromSchema(data, publicId) {
  const ts = new Date().toISOString();
  const pagePath = data._page?.path || data.source || "";
  const lines = [];
  lines.push(`[自然大叔預約]`);
  lines.push(`案件編號: ${publicId}`);
  lines.push(`提交時間: ${ts}`);
  if (pagePath) lines.push(`來源頁面: ${pagePath}`);
  lines.push("");

  const sections = data._sections || [];
  for (const sec of sections) {
    if (!sec || !sec.title || !Array.isArray(sec.fields)) continue;
    lines.push(`【${sec.title}】`);
    for (const f of sec.fields) {
      const v = f && (f.value!==undefined && f.value!==null) ? (Array.isArray(f.value)? f.value.join(", "): String(f.value)) : "";
      lines.push(`${f.label || f.key}: ${v}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}


function htmlFromSchema(data, publicId) {
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const joinVal = v => Array.isArray(v) ? v.filter(x=>x!=null&&x!=='').join('、') : (v==null||v==='') ? '—' : String(v);
  const row = (label, val) => `<tr><td style="padding:6px 10px;border:1px solid #ddd;background:#fafafa;white-space:nowrap">${esc(label)}</td><td style="padding:6px 10px;border:1px solid #ddd">${esc(joinVal(val))}</td></tr>`;
  const block = (title, rowsHtml) => `
    <h3 style="margin:18px 0 8px 0;font-size:16px">${esc(title)}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${rowsHtml}</table>`;
  const g = (k) => data[k];

  const sections = [
    ["【服務類別】", [
      
      row("服務類別", g("service_category"))  // 可能不存在
    ]],
    ["【冷氣清洗】", [
      row("冷氣類型", g("ac_type")),
      row("清洗數量", g("ac_count")),
      row("室內機所在樓層", g("indoor_floor")),
      row("冷氣品牌", g("ac_brand")),
      row("是否為「變形金剛系列」冷氣機型？", g("ac_transformer_series"))
    ]],
    ["【其他保養清洗】", [
      row("洗衣機清洗數量", g("washer_count")),
      row("洗衣機位於樓層", g("washer_floor")),
      row("水塔清洗數量", g("tank_count")),
      row("自來水管清洗服務", g("pipe_service")),
      row("清洗自來水管的原因", g("pipe_reason"))
    ]],
    ["【團購預約清洗】", [ row("團購預約說明填寫", g("group_notes")) ]],
    ["【大量清洗需求】", [ row("多台預約說明填寫", g("bulk_notes")) ]],
    ["【加購服務專區】", [
      row("防霉", g("addon_antimold")),
      row("臭氧", g("addon_ozone"))
    ]],
    ["【聯繫名稱說明】", [
      row("與我們聯繫方式", g("contact_method")),
      row("LINE 名稱 or Facebook 名稱", g("social_name"))
    ]],
    ["【預約資料填寫】", [
      row("可安排時段", g("timeslot")),
      row("顧客姓名", g("name")),
      row("聯繫電話", g("phone")),
      row("方便聯繫時間", g("contact_time_preference")),
      row("清洗保養地址", g("address")),
      row("居住地型態", g("housing_type")),
      row("其他備註說明", g("note"))
    ]]
  ];

  const meta = `
    <div style="margin:6px 0 18px 0;color:#666;font-size:12px">
      案件編號：${esc(publicId)}<br/>
      送出時間：${esc(new Date().toLocaleString('zh-TW', {hour12:false}))}
    </div>`;

  const body = sections.map(([title, rows]) => block(title, rows.join(""))).join("\n");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">${meta}${body}</div>`;
}
export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const {
    BREVO_API_KEY, MAIL_TO, MAIL_TO_BACKUP, MAIL_FROM,
    CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
  } = process.env;

  const data = parseBody(event);

  // gate: only final step triggers email+backup
  const path = (data._page?.path || "").toLowerCase();
  const isFinal = data._final === true || path.includes("final-booking");
  if (!isFinal) {
    return { statusCode: 200, body: JSON.stringify({ ok:true, stage:"ignored_non_final" }) };
  }

  // stable id provided by client; fallback to hash of core fields + day
  const clientId = String(data._id || "");
  const hash = crypto.createHash("sha1")
    .update(JSON.stringify({name:data.name||"", phone:data.phone||"", address:data.address||"", day:new Date().toISOString().slice(0,10)}))
    .digest("hex").slice(0,8);
  const public_id = clientId ? `booking_${clientId}` : `booking_${hash}`;

  // plain-text email body using sections produced on client
  const name = data.name || "";
  const phone = data.phone || "";
  const subject = "[自然大叔預約] 新預約：";
  const textContent = textFromSchema(data, public_id);
  const htmlContent = htmlFromSchema(data, public_id);

  const recipients = [];
  if (MAIL_TO) recipients.push({ email: MAIL_TO });
  if (MAIL_TO_BACKUP) recipients.push({ email: MAIL_TO_BACKUP });

  const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
    body: JSON.stringify({
      sender: { email: MAIL_FROM, name: "自然大叔預約" },
      to: recipients,
      replyTo: data.email ? { email: data.email } : undefined,
      subject,
      textContent,
      htmlContent,
      tags: ["booking"],
      headers: {
        "X-Mailin-Tag": "booking",
        "X-Mailin-Track": "0",
        "X-Mailin-Track-Links": "0",
        "X-Mailin-Track-Opens": "0"
      }
    })
  });
  if (!emailRes.ok) {
    return { statusCode: 502, body: JSON.stringify({ ok:false, stage:"brevo", error: await emailRes.text(), to: recipients }) };
  }

  // Cloudinary upload once with overwrite=false
  try {
    const timestamp = Math.floor(Date.now()/1000);
    const folder = "uncle-bookings";
    const overwrite = "false";
    const toSign = `folder=${folder}&overwrite=${overwrite}&public_id=${public_id}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");

    const payloadB64 = Buffer.from(JSON.stringify({ ...data, createdAt: new Date().toISOString(), _public_id: public_id })).toString("base64");
    const form = new FormData();
    form.set("file", `data:application/json;base64,${payloadB64}`);
    form.set("api_key", CLOUDINARY_API_KEY);
    form.set("timestamp", String(timestamp));
    form.set("signature", signature);
    form.set("folder", folder);
    form.set("public_id", public_id);
    form.set("overwrite", overwrite);

    const upRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, { method: "POST", body: form });
    const text = await upRes.text();
    if (!upRes.ok) {
      if (text.includes("already exists")) {
        return { statusCode: 200, body: JSON.stringify({ ok:true, cloudinary:{ public_id, existed:true } }) };
      }
      return { statusCode: 207, body: JSON.stringify({ ok:true, warning:"cloudinary_failed", error: text }) };
    }
    const up = JSON.parse(text);
    return { statusCode: 200, body: JSON.stringify({ ok:true, cloudinary:{ public_id: up.public_id, existed:false } }) };
  } catch (e) {
    return { statusCode: 207, body: JSON.stringify({ ok:true, warning:"cloudinary_failed", error: String(e) }) };
  }
}

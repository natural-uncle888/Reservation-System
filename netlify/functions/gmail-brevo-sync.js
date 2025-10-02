// gmail-brevo-sync.js (robust parser + preview/sync modes)
const { google } = require("googleapis");
const cheerio = require("cheerio");
const cloudinary = require("cloudinary").v2;

const CORS = { "Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*" };
const ok  = (b)=>({ statusCode:200, headers:CORS, body:JSON.stringify(b) });
const err = (e)=>({ statusCode:500, headers:CORS, body:JSON.stringify({ error:String(e&&e.message||e) }) });

// ---- Gmail auth ----
function oauth(){
  const o = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/oauth2callback"
  );
  o.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return o;
}

// ---- Cloudinary ----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---- helpers ----
function b64urlDecode(s){
  if(!s) return "";
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  const pad = 4 - (s.length % 4);
  if (pad !== 4) s += "=".repeat(pad);
  return Buffer.from(s,"base64").toString("utf-8");
}
const trim1 = v => (v==null ? "" : String(v).replace(/\s+/g," ").trim());
const cleanList = v => trim1(v).replace(/[，；]/g,"、").replace(/\s*、\s*/g,"、");

// 解析 URL 參數（支援 GET ?q=...&mode=...）
function getParams(event){
  let q=null, mode=null;
  try{
    const url = new URL(event.rawUrl || ("https://x"+(event.path||"")) + (event.rawQuery?("?"+event.rawQuery):""));
    q = url.searchParams.get("q");
    mode = url.searchParams.get("mode");
  }catch(_){}
  return { q, mode:(mode||"preview").toLowerCase() };
}

// ---- 強化解析器：支援表格/定義清單/粗體標題/冒號行/相鄰段落 ----
function parseBrevoHtml(html){
  const $ = cheerio.load(html, { decodeEntities:false });
  const out = {};

  // 1) 表格 2 欄
  $("table tr").each((_, tr)=>{
    const tds = $(tr).find("td,th");
    if (tds.length === 2){
      const k = trim1($(tds[0]).text());
      const v = trim1($(tds[1]).text());
      if (k && v) out[k] = v;
    }
  });

  // 2) 定義清單 <dl><dt>k</dt><dd>v</dd>
  $("dl").each((_, dl)=>{
    $(dl).find("dt").each((i, dt)=>{
      const k = trim1($(dt).text());
      const v = trim1($(dl).find("dd").eq(i).text());
      if (k && v) out[k] = v;
    });
  });

  // 3) 粗體/strong 當標題，下個元素當值
  $("strong,b").each((_, el)=>{
    const k = trim1($(el).text());
    let v = trim1($(el).parent().next().text());
    if (!v) v = trim1($(el).next().text());
    if (k && v && !out[k]) out[k] = v;
  });

  // 4) 冒號行：「欄名：值」
  const texts = [];
  $("p,li,div,span").each((_, el)=>{
    const t = trim1($(el).text());
    if (t) texts.push(t);
  });
  texts.forEach(t=>{
    const m = t.match(/^(.{1,40})[:：]\s*(.+)$/);
    if (m && !out[m[1]] && m[2]) out[m[1]] = m[2];
  });

  // 5) PDF 連結
  const pdf = $('a[href*=".pdf"]').first().attr("href");
  if (pdf) out["PDF"] = pdf;

  // 格式清理：把中文逗號改成頓號，去除多餘空白
  Object.keys(out).forEach(k=>{ out[k] = cleanList(out[k]); });
  return out;
}

// ---- 映射（加入常見中文別名；依你截圖與 .eml 擴充）----
const WANT_KEYS = [
  "name","phone","address","service","ac_type","brand","count","floor",
  "is_inverter","antifungus","ozone","extra_service","date","timeslot",
  "contact_time","residence","note","pdf","line"
];
const pick=(m,keys)=>{ for(const k of keys){ const v=m[k]; if(v && trim1(v)!=="") return trim1(v); } return ""; };
const yn = s=>{
  const t = trim1(s);
  if (!t) return "";
  if (/^(是|有|yes|true|y)$/i.test(t)) return "是";
  if (/^(否|無|沒有|no|false|n)$/i.test(t)) return "否";
  return t;
};

function normalize(m){
  return {
    // 聯絡/識別
    name:          pick(m, ["顧客姓名","姓名","name","預約人","聯絡人"]),
    phone:         pick(m, ["聯絡電話","電話","phone","行動電話","手機"]),
    line:          pick(m, ["LINE 或 Facebook 名稱","LINE 或 Facebook名稱","LINE 名稱 or Facebook 名稱","LINE/Facebook","LINE或Facebook名稱","LINE"]),
    address:       pick(m, ["清洗保養地址","服務地址","地址","安裝/服務地址"]),

    // 服務主體
    service:       pick(m, ["服務類別","服務","service","服務項目"]),
    ac_type:       pick(m, ["冷氣類型","ac_type","機型","室內機型"]),
    brand:         pick(m, ["冷氣品牌","brand","品牌","冷氣機品牌"]),
    count:         pick(m, ["清洗數量","台數","數量","直立式洗衣機台數","洗衣機台數","count"]),
    floor:         pick(m, ["室內機所在樓層","洗衣機樓層","樓層","floor"]),
    is_inverter:   yn(pick(m, ["是否為變形金剛系列","機型","is_inverter"])),

    // 加購/額外
    antifungus:    yn(pick(m, ["冷氣防霉抗菌處理","防霉抗菌","antifungus"])),
    ozone:         yn(pick(m, ["臭氧空間消毒","臭氧殺菌消毒","臭氧消毒","臭氧","ozone"])),
    extra_service: pick(m, ["其他清洗服務","其他服務","extra_service"]),

    // 時程與備註
    date:          pick(m, ["預約日期","服務日期","date"]),
    timeslot:      pick(m, ["預約時段","可安排時段","服務時段","timeslot","timeslot","時段"]),
    contact_time:  pick(m, ["方便聯繫時間","聯絡時段","contact_time"]),
    residence:     pick(m, ["居住地型態","屋住類型","房屋型態","residence"]),
    note:          pick(m, ["其他備註","備註","note","留言"]),
    pdf:           pick(m, ["PDF","pdf","pdf_url","附件連結"])
  };
}

// ---- 主處理 ----
exports.handler = async (event) => {
  try{
    const { q:qParam, mode } = getParams(event);
    const auth = oauth();
    const gmail = google.gmail({ version:"v1", auth });
    const userId = process.env.GMAIL_USER;
    if(!userId) return err("Missing GMAIL_USER");

    const q = qParam || 'in:anywhere newer_than:180d (from:brevo OR subject:(預約 OR 預約來了 OR booking))';
    const list = await gmail.users.messages.list({
      userId, q, includeSpamTrash:true, maxResults: 10
    });
    const msgs = list.data.messages || [];

    // ---- 預覽模式：列出主旨 + 解析預覽 + 缺漏鍵 ----
    if (mode === "preview"){
      const previews = [];
      for (const m of msgs){
        // 讀 metadata
        const meta = await gmail.users.messages.get({
          userId, id: m.id, format:"metadata", metadataHeaders:["Subject","From","Date"]
        });
        const headers = meta.data.payload.headers || [];
        const getH = n => (headers.find(h=>h.name===n)||{}).value || "";

        // 讀 full → 解碼 → 解析
        const full = await gmail.users.messages.get({ userId, id: m.id, format:"full" });
        let html = "";
        const walk = p => { if(!p) return;
          if (p.mimeType==="text/html" && p.body && p.body.data) html = b64urlDecode(p.body.data);
          (p.parts||[]).forEach(walk);
        };
        walk(full.data.payload);

        const map = parseBrevoHtml(html);
        const norm = normalize(map);
        const missing = WANT_KEYS.filter(k => !norm[k]);

        previews.push({
          id: m.id,
          subject: getH("Subject"),
          from: getH("From"),
          date: getH("Date"),
          foundKeys: Object.keys(map),
          normalizedPreview: norm,
          missingKeys: missing
        });
      }
      return ok({ mode, usedQuery:q, count:previews.length, previews });
    }

    // ---- 同步模式：寫回 Cloudinary context.custom ----
    let updated = 0;
    for (const m of msgs){
      const full = await gmail.users.messages.get({ userId, id: m.id, format:"full" });

      let html = "";
      const walk = p => { if(!p) return;
        if (p.mimeType==="text/html" && p.body && p.body.data) html = b64urlDecode(p.body.data);
        (p.parts||[]).forEach(walk);
      };
      walk(full.data.payload);
      if (!html) continue;

      const map = parseBrevoHtml(html);
      const norm = normalize(map);
      const custom = Object.assign({}, map, norm);

      // 產生 public_id：優先用 PDF 檔名，否則用主旨+internalDate
      const headers = full.data.payload.headers || [];
      const subject = (headers.find(h=>h.name==="Subject")||{}).value || "booking";
      const internalDate = full.data.internalDate || Date.now().toString();
      let publicId = subject.replace(/[^\w\-]+/g,"_")+"_"+internalDate;
      if (norm.pdf){
        const m2 = norm.pdf.match(/\/([^\/]+)\.pdf$/i);
        if (m2) publicId = m2[1];
      }

      try{
        await cloudinary.api.update(publicId, { resource_type:"raw", type:"upload", context: custom });
      }catch(_){
        await new Promise((resolve,reject)=>{
          const s = cloudinary.uploader.upload_stream(
            { resource_type:"raw", public_id: publicId, type:"upload", context: custom },
            e=> e ? reject(e) : resolve()
          );
          s.end(Buffer.from("{}", "utf-8"));
        });
      }
      updated++;
    }

    return ok({ mode, usedQuery:q, updated });

  }catch(e){
    console.error(e);
    return err(e);
  }
};

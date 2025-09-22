// netlify/functions/submit.js
// Brevo 發信 + 可選 Cloudinary 備份
// 功能：欄位別名對齊、加購/其他清洗進信件、樓層格式化、美化版面、居住地型態去重、聯繫時間獨立顯示與排序

const crypto = require("crypto");
function parseBody(event){const h=event.headers||{};const ct=(h["content-type"]||h["Content-Type"]||"").split(";")[0].trim().toLowerCase();if(ct==="application/json"||!ct){try{return JSON.parse(event.body||"{}");}catch{return{};}}if(ct==="application/x-www-form-urlencoded"){const params=new URLSearchParams(event.body||"");const obj={};for(const[k,v]of params.entries())obj[k]=v;return obj;}return{};}
const nb=v=>(v==null?"":String(v)).trim();const nk=v=>nb(v).replace(/\s+/g,"");const toArr=v=>Array.isArray(v)?v:(v==null||v===""?[]:[v]);const splitVals=v=>Array.isArray(v)?v:nb(v)?nb(v).split(/[、,\s]+/):[];
const isPH=v=>{const t=nb(v).toLowerCase();return t==="其他"||t==="other"||t==="請輸入"||t==="自填"||t==="自行填寫";};
function dedupMerge(){const seen=new Set(),out=[];for(let x of Array.from(arguments).flatMap(splitVals)){if(!x||isPH(x))continue;x=String(x).replace(/^(其他|other)\s*[:：]\s*/i,"").trim();const key=nk(x).replace(/[樓層f台]/gi,"");if(key&&!seen.has(key)){seen.add(key);out.push(x);}}return out;}
const nInt=s=>{const m=nb(s).match(/[0-9]+/);return m?parseInt(m[0],10):NaN;};const fmtCount=s=>{const n=nInt(s);if(!Number.isFinite(n))return nb(s);if(/以上|含/.test(nb(s)))return`${n}台以上`;return`${n}台`;};
function fmtFloor(s){const t=nb(s).replace(/\s+/g,"");const m1=t.match(/^(?:5樓以上)[:：]?([0-9]+)$/i);if(m1)return`${m1[1]}樓`;const m2=t.match(/^([0-9]+)(?:樓|F)?$/i);if(m2)return`${m2[1]}樓`;return t.toUpperCase();}
const tr=(k,v)=>{if(v==null)return"";const t=Array.isArray(v)?v.join("、"):nb(v);if(!t)return"";return`<tr><th style="text-align:left;width:160px;padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#374151;white-space:nowrap;">${k}</th><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#111827;">${t}</td></tr>`;};
const section=(title,rows)=>{if(!rows||!nb(rows))return"";return`<div style="margin:18px 0;padding:14px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;"><h3 style="margin:0 0 10px;font-size:16px;color:#2563eb;">${title}</h3><table style="border-collapse:collapse;width:100%;">${rows}</table></div>`;};

function buildEmailHtml(p){
  const indoorArr=dedupMerge(p.indoor_floor,p.indoor_floor_other).map(fmtFloor).filter(Boolean);
  const indoor=Array.from(new Set(indoorArr)).join("、");
  const brand=dedupMerge(p.ac_brand,p.ac_brand_other).join("、");
  const countA=dedupMerge(p.ac_count,p.ac_count_other).map(fmtCount);
  const count=countA.length?countA.join("、"):(p.ac_count||"");

  // 居住地型態 display
  (function(){
    const arr=toArr(p.house_type).concat(toArr(p.housing_type));
    const extra=nb(p.housing_type_other)||nb(p.house_type_other);
    if(extra)arr.push(extra);
    const norm=s=>nb(s).replace(/^其他\s*[:：]\s*/i,"");
    const seen=new Set();
    p._house_type_display=arr.map(norm).filter(x=>{const k=nk(x);if(!k)return false;if(seen.has(k))return false;seen.add(k);return true;});
    if(p._house_type_display.length===1)p._house_type_display=p._house_type_display[0];
  })();

  // 聯繫時間 display + timeslot 併入排序
  (function(){
    const KNOWN=["平日","假日","上午","下午","晚上","皆可"];
    let pref=toArr(p.contact_time_preference);
    const custom=nb(p.contact_time_preference_other)||nb(p.timeslot_other)||nb(p.time_other);
    if(custom)pref.push(`其他指定時間：${custom}`);
    const norm=s=>nb(s);
    const seen=new Set();
    pref=pref.map(norm).filter(x=>x).filter(x=>{const k=x;if(seen.has(k))return false;seen.add(k);return true;});
    const isCustom=x=>x.startsWith("其他指定時間：");
    const customs=pref.filter(isCustom);
    const rest=pref.filter(x=>!isCustom(x)&&!KNOWN.includes(x));
    const ordered=[];for(const k of KNOWN)if(pref.includes(k))ordered.push(k);ordered.push(...rest,...customs);
    p._contact_time_display=ordered.length===1?ordered[0]:ordered;
    // 合併到 timeslot 顯示
    let ts=toArr(p.timeslot);const inTs=new Set(ts.map(norm));for(const x of ordered){const k=norm(x);if(!inTs.has(k))ts.push(k);}
    p._timeslot_display=ts.length===1?ts[0]:ts;
  })();

  const service=[
    tr("服務類別",p.service_category),
    tr("冷氣類型",p.ac_type),
    tr("清洗數量",count),
    tr("室內機所在樓層",indoor),
    tr("冷氣品牌",brand),
    tr("是否為變形金剛系列",p.ac_transformer_series)
  ].join("");

  const addon=[
    tr("冷氣防霉抗菌處理",p.anti_mold?"需要":""),
    tr("臭氧空間消毒",p.ozone?"需要":"")
  ].join("");

  const otherSvc=[
    tr("直立式洗衣機台數",p.washer_count),
    tr("洗衣機樓層",Array.isArray(p.washer_floor)?p.washer_floor.join("、"):p.washer_floor),
    tr("自來水管清洗",p.pipe_service),
    tr("水管清洗原因",p.pipe_reason),
    tr("水塔清洗台數",p.tank_count)
  ].join("");

  const contact=[
    tr("與我們聯繫方式",p.contact_method),
    tr("LINE 名稱 or Facebook 名稱",p.line_or_fb)
  ].join("");

  const booking=[
    tr("可安排時段",p._timeslot_display??p.timeslot),
    tr("方便聯繫時間",p._contact_time_display),
    tr("顧客姓名",p.customer_name),
    tr("聯繫電話",p.phone),
    tr("清洗保養地址",p.address),
    tr("居住地型態",p._house_type_display??p.house_type),
    tr("其他備註說明",p.note)
  ].join("");

  const svc=String(p.service_category||"");
  const isGroup=/團購/.test(svc),isBulk=/大量清洗/.test(svc);
  let freeTitle="",freeRows="";
  if(isGroup&&p.group_notes){freeTitle="團購自由填寫";freeRows=tr("團購自由填寫",p.group_notes);}
  if(isBulk&&p.bulk_notes){freeTitle="大量清洗需求";freeRows=tr("大量清洗需求",p.bulk_notes);}

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;background:#ffffff;color:#111827;">${freeTitle?section(freeTitle,freeRows):""}${section("服務資訊",service)}${addon.trim()?section("防霉・消毒｜加購服務專區",addon):""}${otherSvc.trim()?section("其他清洗服務",otherSvc):""}${section("聯繫名稱說明",contact)}${section("預約資料填寫",booking)}</div>`;
}

exports.handler=async(event)=>{
  if(event.httpMethod!=="POST")return{statusCode:405,body:"Method Not Allowed"};
  try{
    const p=parseBody(event);
    p.customer_name=p.customer_name||p.name;
    p.line_or_fb=p.line_or_fb||p.social_name;
    p.house_type=p.house_type||p.housing_type;
    const path=(p._page&&p._page.path?String(p._page.path):(event.rawUrl||"")).toLowerCase();
    const isFinal=p._final===true||path.includes("final-booking");
    if(!isFinal)return{statusCode:200,body:JSON.stringify({ok:true,stage:"ignored_non_final"})};
    const subject=`${process.env.EMAIL_SUBJECT_PREFIX||""}${p.subject||"新預約通知"}`;
    const html=buildEmailHtml(p);
    const toList=String(process.env.EMAIL_TO||process.env.MAIL_TO||"").split(",").map(s=>s.trim()).filter(Boolean).map(email=>({email}));
    if(!toList.length)throw new Error("EMAIL_TO 未設定");
    const senderEmail=nb(process.env.EMAIL_FROM);
    const senderId=nb(process.env.BREVO_SENDER_ID);
    if(!senderEmail&&!senderId)throw new Error("Missing EMAIL_FROM or BREVO_SENDER_ID");
    const sender=senderEmail?{email:senderEmail}:{id:Number(senderId)};
    const res=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":nb(process.env.BREVO_API_KEY),"content-type":"application/json"},body:JSON.stringify({sender,to:toList,subject,htmlContent:html,tags:["reservation"]})});
    if(!res.ok)throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    return{statusCode:200,body:JSON.stringify({ok:true})};
  }catch(err){
    return{statusCode:500,body:JSON.stringify({ok:false,error:String((err&&err.message)||err)})};
  }
};


// booking-app.v1.js — single source of truth with schema and builder
(function(){
  const LS_DATA = 'BOOKING_STATE';
  const FN='/.netlify/functions/submit';
  const DEBUG=/\bdebug=1\b/i.test(location.search)||localStorage.getItem('BOOKING_DEBUG')==='1';

  const KEY_ALIAS = {
    "time":"timeslot","contact":"contact_time_preference","houseType":"housing_type",
    "contact-method":"contact_method","contact-name":"social_name",
    "quantity":"ac_count","quantity_more":"ac_count_more","floor[]":"indoor_floor","brand[]":"ac_brand",
    "washer":"washer_count","washer-floor":"washer_floor","watertank":"tank_count","pipe":"pipe_service","reason":"pipe_reason"
  };

  const SCHEMA = {
    timeslot: {type:'array'},               // 可安排時段
    contact_time_preference: {type:'array'},// 方便聯繫時間
    housing_type: {type:'string'},          // 居住地型態
    contact_method: {type:'array'},         // 與我們聯繫方式
    social_name: {type:'string'},           // LINE/Facebook 名稱
    name:{type:'string'}, phone:{type:'string'}, address:{type:'string'}, note:{type:'string'}
  };

  function log(){ try{ if(DEBUG) console.log('[booking]', ...arguments); }catch(e){} }
  function getState(){ try{ return JSON.parse(localStorage.getItem(LS_DATA)||'{}'); } catch(_){ return {}; } }
  function setState(patch){ const s=getState(); const out=Object.assign({}, s, patch||{}); localStorage.setItem(LS_DATA, JSON.stringify(out)); return out; }
  function clearState(){ localStorage.removeItem(LS_DATA); }

  // Generic capture on any page
  function captureFromDom(root){
    const data={};
    const doc = root||document;
    doc.querySelectorAll('input[name],textarea[name],select[name]').forEach(el=>{
      const rawName = el.name;
      const key = KEY_ALIAS[rawName] || rawName;
      if (el.type==='checkbox'){
        if (!el.checked) return;
        (data[key]||(data[key]=[])).push(el.value || '是');
      } else if (el.type==='radio'){
        if (el.checked) data[key] = el.value || '是';
      } else {
        const v = (el.value||'').trim();
        if (!v) return;
        if (Array.isArray(data[key])) data[key].push(v);
        else if (data[key]) data[key]=[data[key], v];
        else data[key]=v;
      }
    });
    return data;
  }

  // Merge "other + text"
  function mergeOther(base, otherText){
    const t=(otherText||'').trim();
    if (!t) return base;
    return Array.isArray(base) ? base.concat([t]) : (base ? [base, t] : t);
  }

  // Build payload on final page
  
function buildPayload(){
  const qs = (function(){ try{ return Object.fromEntries(new URLSearchParams(location.search||'')); }catch(_){ return {}; } })();
  const s = Object.assign({}, getState(), qs, captureFromDom(document));

  const out = {};
  for (const [k,v] of Object.entries(s)){
    const key = KEY_ALIAS[k] || k;
    out[key] = v;
  }

  // Helpers
  const dedup = a => Array.from(new Set([].concat(a||[]).map(x=>String(x).trim()).filter(x=>x && x!=='on')));
  const join = a => dedup(a).join('、');
  const text = id => { try{ return (document.getElementById(id)?.value||'').trim(); }catch(_){ return ''; } };

  // timeslot
  let ts = dedup(out.timeslot);
  const tsExtra = s.time_other || s.other_time || s['otherTimeInput'] || text('otherTimeInput');
  if (tsExtra) ts = dedup(ts.concat([tsExtra]));
  if (ts.length) out.timeslot = ts; else delete out.timeslot;

  // contact_time_preference
  out.contact_time_preference = dedup(out.contact_time_preference);
  if (!out.contact_time_preference.length) delete out.contact_time_preference;

  // housing_type: build from selected radio + extra once
  let selectedHousing = s.housing_type || s.houseType || '';
  const extraHousing = s.housing_type_other || s.otherTypeInput || text('otherTypeInput');
  if (/其他/.test(String(selectedHousing)) && extraHousing) {
    out.housing_type = `其他、${extraHousing.trim()}`;
  } else if (selectedHousing) {
    out.housing_type = String(selectedHousing).trim();
  } else if (extraHousing) {
    out.housing_type = String(extraHousing).trim();
  } else {
    delete out.housing_type;
  }

  // contact_method: make single string, include '其他＋文字' if present
  let cm = [].concat(out.contact_method||[]);
  const otherMethod = s['other-method'] || s.other_method || '';
  if (cm.length===0 && (s['contact-method']||s.contact_method)) cm = [s['contact-method']||s.contact_method];
  if (cm.some(v=>/其他/.test(String(v))) && otherMethod.trim()) {
    cm = dedup(cm.concat([otherMethod.trim()]));
  }
  if (cm.length) out.contact_method = join(cm); else delete out.contact_method;

  // social_name
  if (s['contact-name'] && !out.social_name) out.social_name = s['contact-name'];

  // Remove empty / 'on'
  for (const k of Object.keys(out)){
    const v=out[k];
    if (v==null) { delete out[k]; continue; }
    if (typeof v==='string' && (v==='' || v==='on')) { delete out[k]; continue; }
    if (Array.isArray(v) && !v.length) delete out[k];
  }

  out._id = 'bk_'+Date.now().toString(36);
  out._final = true;
  out._page = { title: document.title, path: location.pathname, url: location.href };
  return out;
}
Array.prototype.forEach.call(document.forms, f=> f.addEventListener('submit', onSubmit, {capture:true}));

  // Expose for debugging
  window.__booking__ = { getState, setState, buildPayload };
})();

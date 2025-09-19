
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
    const s = Object.assign({}, getState(), qs, captureFromDom(document)); // final safeguard

    // Map aliases
    const out = {};
    for (const [k,v] of Object.entries(s)){
      const key = KEY_ALIAS[k] || k;
      out[key] = v;
    }

    // Normalize arrays
    if (out.timeslot && !Array.isArray(out.timeslot)) out.timeslot=[out.timeslot];
    if (out.contact_time_preference && !Array.isArray(out.contact_time_preference)) out.contact_time_preference=[out.contact_time_preference];
    if (out.contact_method && !Array.isArray(out.contact_method)) out.contact_method=[out.contact_method];

    // Contact method "其他 + text"
    out.contact_method = mergeOther(out.contact_method, s['other-method'] || s.other_method);
    // Timeslot "其他指定時間"
    out.timeslot = mergeOther(out.timeslot, s.time_other || s.other_time || s['otherTimeInput'] || '' || ((document.getElementById('otherTimeInput')||{}).value||''));
    // Housing type "其他 + text"
    if (s.houseType==='其他' || s.housing_type==='其他'){
      out.housing_type = mergeOther(out.housing_type || '其他', s.housing_type_other || s.otherTypeInput || ((document.getElementById('otherTypeInput')||{}).value||''));
    }

    // Social name
    if (s['contact-name'] && !out.social_name) out.social_name = s['contact-name'];

    // Remove empty and 'on'
    for (const k of Object.keys(out)){
      const v=out[k];
      if (v==null) { delete out[k]; continue; }
      if (typeof v==='string' && (v==='' || v==='on')) { delete out[k]; continue; }
      if (Array.isArray(v)) {
        const filt = v.filter(x=>String(x).trim()!=='' && x!=='on');
        out[k] = filt.length ? filt : undefined;
        if (!out[k]) delete out[k];
      }
    }
    // Attach meta
    out._id = (function(){ const d=new Date(); return 'bk_'+d.getTime().toString(36); })();
    out._final = true;
    out._page = { title: document.title, path: location.pathname, url: location.href };
    return out;
  }

  // Attach listeners on all pages to persist state
  document.addEventListener('change', function(e){
    const t=e.target;
    if (!t || !t.name) return;
    setState(captureFromDom(t.closest('form')||document));
  }, {capture:true});

  // Final page submission
  function onSubmit(e){
    const form=e.target;
    const isFinal = /final-booking/i.test(location.pathname) || form.hasAttribute('data-final');
    if (!isFinal) return; // Let non-final pages proceed to next
    e.preventDefault();
    const payload = buildPayload();
    if (DEBUG) log('payload', payload);

    fetch(FN, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
      .then(async res=>{
        const txt = await res.text();
        if (!res.ok) throw new Error('['+res.status+'] '+txt.slice(0,500));
        try{ form.reset(); }catch(_){}
        clearState();
        const toast=document.getElementById('toast');
        if (toast){ toast.style.display='block'; setTimeout(()=>{ toast.style.display='none'; location.href='index.html'; }, 1500); }
        else { setTimeout(()=>{ location.href='index.html'; }, 1200); }
      })
      .catch(err=>{
        alert('提交失敗：'+err.message);
        if (DEBUG) log('submit error', err);
      });
  }
  Array.prototype.forEach.call(document.forms, f=> f.addEventListener('submit', onSubmit, {capture:true}));

  // Expose for debugging
  window.__booking__ = { getState, setState, buildPayload };
})();

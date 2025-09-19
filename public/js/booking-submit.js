// public/js/booking-submit.js v8-strict — rely on explicit names or data-field/data-value
(function(){
  const FN='/.netlify/functions/submit';
  const LS_ID='BOOKING_ID';
  const LS_DATA='BOOKING_DATA';
  const DEBUG=/\bdebug=1\b/i.test(location.search)||localStorage.getItem('BOOKING_DEBUG')==='1';

  const REQUIRED = [
    // index
    'entry',
    // ac-booking
    'ac_type','ac_count','indoor_floor','ac_brand','ac_transformer_series',
    // other-service
    'washer_count','washer_floor','tank_count','pipe_service','pipe_reason',
    // group/bulk
    'group_notes','bulk_notes',
    // addon
    'addon_antimold','addon_ozone',
    // contact
    'contact_method','social_name',
    // final
    'timeslot','name','phone','contact_time_preference','address','housing_type','note'
  ];

  function log(){ if(DEBUG) try{ console.log.apply(console, ['[booking]', ...arguments]); }catch(e){} }
  function uid(){ return (Date.now().toString(36)+Math.random().toString(36).slice(2,8)); }
  function getId(){ let id=localStorage.getItem(LS_ID); if(!id){ id=uid(); localStorage.setItem(LS_ID,id); } return id; }
  function getDraft(){ try{ return JSON.parse(localStorage.getItem(LS_DATA)||'{}'); }catch(_){ return {}; } }
  function saveDraft(obj){ const cur=getDraft(); const next=Object.assign({}, cur, obj); localStorage.setItem(LS_DATA, JSON.stringify(next)); if(DEBUG) log('draft', next); }
  function clearDraft(){ localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_ID); }

  function captureFromNames(root){
    const data={};
    (root||document).querySelectorAll('input[name],textarea[name],select[name]').forEach(el=>{
      const key = el.name;
      if (!key) return;
      if (el.type==='checkbox') {
        const list = (data[key]||[]);
        if (el.checked) list.push(el.value || '是');
        data[key]=list;
      } else if (el.type==='radio') {
        if (el.checked) data[key]=el.value || el.labels?.[0]?.textContent?.trim() || '';
      } else if (el.tagName==='SELECT' && el.multiple) {
        data[key]=Array.from(el.selectedOptions).map(o=>o.value);
      } else {
        data[key]=el.value;
      }
    });
    // alias: name="time" → timeslot
    const times = Array.from((root||document).querySelectorAll('input[type="checkbox"][name="time"]:checked')).map(i=>i.value);
    if (times.length) data.timeslot = times;
    return data;
  }

  function captureFromDataFields(root){
    const out={};
    (root||document).querySelectorAll('[data-field]').forEach(cont=>{
      const key=cont.getAttribute('data-field');
      if (!key) return;
      // selected option
      const selected = cont.querySelector('[data-value].is-selected,[data-value][aria-pressed="true"],[data-value][aria-checked="true"]');
      if (selected) { out[key] = selected.getAttribute('data-value') || selected.textContent.trim(); return; }
      // any checked checkbox/radio inside
      const checks = Array.from(cont.querySelectorAll('input[type="checkbox"][data-value]:checked,input[type="radio"][data-value]:checked'));
      if (checks.length) { out[key] = checks.map(x=>x.getAttribute('data-value')||x.value||'是'); return; }
      // single clicked link/button remembered via data-current
      const cur = cont.querySelector('[data-current="1"][data-value]');
      if (cur) { out[key]=cur.getAttribute('data-value'); return; }
    });
    return out;
  }

  function pagePath(){ return location.pathname; }
  function isFinalPage(){ return /final-booking/i.test(pagePath()) || document.querySelector('form[data-final="1"]'); }
  function pageTitle(){ return document.title||''; }

  function buildSections(draft){
    const groups = [
      { title:"冷氣清洗", fields:['ac_type','ac_count','indoor_floor','ac_brand','ac_transformer_series'] },
      { title:"其他保養清洗", fields:['washer_count','washer_floor','tank_count','pipe_service','pipe_reason'] },
      { title:"團購預約清洗", fields:['group_notes'] },
      { title:"大量清洗需求", fields:['bulk_notes'] },
      { title:"加購服務專區", fields:['addon_antimold','addon_ozone'] },
      { title:"聯繫名稱說明", fields:['contact_method','social_name'] },
      { title:"預約資料填寫", fields:['timeslot','name','phone','contact_time_preference','address','housing_type','note'] }
    ];
    return groups.map(g => ({ title:g.title, fields: g.fields.map(k => ({ key:k, label:k, value: (draft[k]||'') })) }));
  }

  function missingKeys(obj){
    return REQUIRED.filter(k => !(k in obj) || (Array.isArray(obj[k]) ? obj[k].length===0 : String(obj[k]).trim()===''));
  }

  function onClick(e){
    const a = e.target.closest('a[href]');
    if (a && a.closest('[data-field="entry"]')) {
      const val = a.getAttribute('data-value') || a.textContent.trim();
      // remember selection by setting data-current on clicked
      a.closest('[data-field="entry"]').querySelectorAll('[data-value]').forEach(n=>n.removeAttribute('data-current'));
      a.setAttribute('data-current','1');
      saveDraft({ entry: val });
      return;
    }
    const opt = e.target.closest('[data-field] [data-value]');
    if (opt) {
      const cont = opt.closest('[data-field]');
      cont.querySelectorAll('[data-value]').forEach(n=>n.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      const key = cont.getAttribute('data-field');
      saveDraft({ [key]: opt.getAttribute('data-value') || opt.textContent.trim() });
    }
  }

  function onChange(e){
    const t=e.target;
    if (!t || !t.name) return;
    saveDraft(captureFromNames(document));
  }

  async function submitFinal(form){
    const qs = (function(){ try { return Object.fromEntries(new URLSearchParams(location.search||'')); } catch(_) { return {}; } })();
    const draft = normalizeKeys(Object.assign({}, qs, getDraft(), captureFromNames(document), captureFromDataFields(document)));
    const payload = Object.assign({}, draft, {

    // 強制合併與覆寫，確保信件顯示完整
    (function mergeAll(){
      try{
        // 1) 可安排時段 → payload.timeslot
        var ts = Array.prototype.map.call(document.querySelectorAll('input[name="time"]:checked'), i=>i.value);
        var tsExtra = (document.getElementById('otherTimeInput') && document.getElementById('otherTimeInput').value || '').trim();
        if (tsExtra) ts.push(tsExtra);
        if (ts.length) payload.timeslot = ts;

        // 2) 方便聯繫時間 → payload.contact_time_preference
        var ct = Array.prototype.map.call(document.querySelectorAll('input[name="contact"]:checked'), i=>i.value);
        if (ct.length) payload.contact_time_preference = ct;

        // 3) 居住地型態 → payload.housing_type
        var htChecked = document.querySelector('input[name="houseType"]:checked');
        var ht = htChecked ? htChecked.value : '';
        var htExtra = (document.getElementById('otherTypeInput') && document.getElementById('otherTypeInput').value || '').trim();
        if (htChecked && htChecked.id === 'otherType' && htExtra) {
          ht = ht ? [ht, htExtra] : htExtra;
        }
        if (ht) payload.housing_type = ht;

        // 4) 與我們聯繫方式（若使用 Contact 頁帶來的 GET 參數）→ payload.contact_method
        var cm = draft.contact_method;
        var otherText = (draft['other-method'] || draft.other_method || '').trim ? (draft['other-method'] || draft.other_method || '').trim() : (draft['other-method'] || draft.other_method || '');
        if (cm) {
          if (/其他/.test(String(cm)) && otherText) {
            payload.contact_method = Array.isArray(cm) ? cm.concat([otherText]) : [cm, otherText];
          } else {
            payload.contact_method = cm;
          }
        }
      }catch(_){}
    })();
          _id: getId(),
      _final: true,
      _page: { title: pageTitle(), path: pagePath(), url: location.href },
      _sections: buildSections(draft),
      _missing: missingKeys(draft)
    });
    if (DEBUG) { console.warn('[booking] missing:', payload._missing); console.table(payload); }
    const res = await fetch(FN, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (res.ok) { try{ form.reset(); }catch(_){ } clearDraft(); if (typeof window.showSuccessModal==='function') try{ showSuccessModal(); }catch(_){ } }
    else { const t=await res.text(); alert('提交失敗：'+t); }
  }

  function onSubmit(e){
    const form=e.target;
    const method=(form.getAttribute('method')||'GET').toUpperCase();
    if (!isFinalPage()) return;
    if (method==='POST') e.preventDefault();
    submitFinal(form);
  }

  window.addEventListener('DOMContentLoaded', function(){
    document.addEventListener('click', onClick, { capture:true });
    document.addEventListener('change', onChange, { capture:true });
    Array.prototype.forEach.call(document.forms, f => f.addEventListener('submit', onSubmit));
    if (DEBUG) log('ready v8-strict');
  });

  // 對照：把各頁面的實際 name 正規化成後端需要的鍵
  const KEY_ALIAS = {
    "time":"timeslot","contact":"contact_time_preference","houseType":"housing_type",
    "contact-method":"contact_method","contact-name":"social_name",
    "quantity":"ac_count","quantity_more":"ac_count_more","floor[]":"indoor_floor","brand[]":"ac_brand",
    "washer":"washer_count","washer-floor":"washer_floor","watertank":"tank_count","pipe":"pipe_service","reason":"pipe_reason"
  };
  function normalizeKeys(obj){
    const out={}; for(const [k,v] of Object.entries(obj||{})){ out[KEY_ALIAS[k]||k]=v; }
    if(!out.service_category){
      const p=location.pathname.toLowerCase();
      if(p.includes('ac-booking')) out.service_category='冷氣清洗';
      else if(p.includes('other-service')) out.service_category='其他保養清洗';
      else if(p.includes('group-booking')) out.service_category='團購預約清洗';
      else if(p.includes('bulk-booking')) out.service_category='大量清洗需求';
      else if(p.includes('addon-service')) out.service_category='加購服務';
    }
    return out;
  }
})();

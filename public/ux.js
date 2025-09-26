
/* === UX Enhancements (non-breaking) === */
(function(){
  const KEY = 'BOOKING_DATA';

  function readLS(){
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ return {}; }
  }
  function saveLS(data){
    try {
      const prev = readLS();
      localStorage.setItem(KEY, JSON.stringify(Object.assign({}, prev, data)));
    }catch(e){}
  }

  /* 3. Restore data to fields (keep existing collectors intact) */
  function restoreFields(){
    const data = readLS();
    const root = document;
    const elems = root.querySelectorAll('input[name], select[name], textarea[name]');
    elems.forEach(el=>{
      const name = el.name;
      if(!name) return;
      const val = data[name];
      if(val==null) return;
      if(el.type==='checkbox'){
        if(Array.isArray(val)) el.checked = val.includes(el.value);
        else el.checked = !!val;
      }else if(el.type==='radio'){
        el.checked = (el.value==val);
      }else{
        el.value = val;
      }
    });

    // Show autosave banner briefly
    const banner = document.querySelector('.autosave-banner');
    if(banner){ banner.classList.add('show'); setTimeout(()=>banner.classList.remove('show'), 1500); }
  }

  /* 4. Live validation & required asterisks */
  function attachValidation(){
    const root = document;
// (asterisk removed)

    // validators
    const validators = {
      email: v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      tel: v => !v || (/^09\d{8}$/.test(v) || /^0\d{1,2}-?\d{6,8}$/.test(v)), // Taiwan mobile/landline
      text: v => typeof v==='string' && v.trim().length>0
    };

    function validate(el){
      const type = (el.type || el.getAttribute('type') || '').toLowerCase();
      const required = el.required;
      const v = (el.value||'').trim();
      let ok = true;

      if(required){
        ok = validators.text(v);
      }
      if(ok && type==='email') ok = validators.email(v);
      if(ok && (type==='tel' || el.name.includes('phone'))) ok = validators.tel(v);

      const msgSel = el.nextElementSibling && el.nextElementSibling.classList.contains('input-msg') ? el.nextElementSibling : null;
      if(!ok){
        el.classList.remove('is-valid');
        el.classList.add('is-invalid');
        if(!msgSel){
          const p = document.createElement('div'); p.className='input-msg'; p.style.color='var(--error)';
          p.textContent='請確認此欄位填寫格式';
          el.after(p);
        }else{
          msgSel.textContent='請確認此欄位填寫格式';
          msgSel.style.color='var(--error)';
        }
      }else{
        el.classList.remove('is-invalid');
        if(v) el.classList.add('is-valid');
        if(msgSel){ msgSel.textContent=''; }
      }
      return ok;
    }

    root.addEventListener('input', (e)=>{
      const t = e.target;
      if(!(t instanceof HTMLElement)) return;
      if(!t.matches('input, select, textarea')) return;
      validate(t);
      if(t.name){
        // soft-save
        let val = t.value;
        if(t.type==='checkbox'){
          // collect group
          const boxes = root.querySelectorAll(`input[type="checkbox"][name="${t.name}"]`);
          if(boxes.length>1){
            val = Array.from(boxes).filter(b=>b.checked).map(b=>b.value);
          }else{
            val = t.checked;
          }
        }
        if(t.type==='radio'){
          if(t.checked) val = t.value; else return;
        }
        saveLS({[t.name]: val});
      }
    }, {passive:true});
  }

  /* 5. Sticky CTA for existing .nav */
  function makeStickyCTA(){
    const nav = document.querySelector('.nav');
    if(nav) nav.classList.add('sticky');
    // Make primary look
    const submit = document.querySelector('#submit, button[type="submit"]');
    if(submit) submit.classList.add('btn-primary');
  }

  /* 7. Datalists for autofill (only if fields exist) */
  function datalists(){
    const cities = ['台北市','新北市','基隆市','桃園市','新竹市','新竹縣','苗栗縣','台中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣','金門縣','連江縣'];
    const times = ['09:00-12:00','12:00-15:00','15:00-18:00','18:00-21:00'];

    function ensureList(id, arr){
      if(document.getElementById(id)) return;
      const dl = document.createElement('datalist');
      dl.id = id;
      arr.forEach(v=>{ const o=document.createElement('option'); o.value=v; dl.appendChild(o); });
      document.body.appendChild(dl);
    }
    ensureList('tw-cities', cities);
    ensureList('prefer-times', times);

    // heuristics
    const cityInput = document.querySelector('input[name*="city"], input[id*="city"]');
    if(cityInput) cityInput.setAttribute('list','tw-cities');

    const timeInput = document.querySelector('input[name*="time"], input[id*="time"]');
    if(timeInput) timeInput.setAttribute('list','prefer-times');

    // browser autofill hints
    document.querySelectorAll('input[name*="name"]').forEach(i=> i.autocomplete='name');
    document.querySelectorAll('input[name*="phone"], input[type="tel"]').forEach(i=> i.autocomplete='tel');
    document.querySelectorAll('input[type="email"], input[name*="mail"]').forEach(i=> i.autocomplete='email');
    document.querySelectorAll('input[name*="address"]').forEach(i=> i.autocomplete='street-address');
  }

  /* 8. Small "saved" banner (optional) */
  function injectSaveBanner(){
    if(document.querySelector('.autosave-banner')) return;
    const div = document.createElement('div');
    div.className = 'autosave-banner';
    div.textContent = '資料已自動儲存';
    const host = document.querySelector('.wrap, .container, main, body');
    host && host.insertBefore(div, host.firstChild.nextSibling);
  }

  document.addEventListener('DOMContentLoaded', function(){
    try{
      // makeProgress removed
      makeStickyCTA();
      injectSaveBanner();
      restoreFields();
      attachValidation();
      // confirmBeforeSubmit removed
      datalists();
    }catch(e){/* silent */}
  }, {once:true});
})();
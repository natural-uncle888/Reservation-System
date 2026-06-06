
const API_LIST = "/.netlify/functions/list-bookings";
const API_LOGIN = "/.netlify/functions/auth-login";
const API_UPDATE_CTX = "/.netlify/functions/update-booking-context";
let ADMIN_TOKEN = localStorage.getItem("admin_token") || "";
let CURRENT_ITEM = null;
let CURRENT_LIST = [];
let CURRENT_NEXT_CURSOR = null;
let PAGE_CURSORS = [null];
let CURRENT_PAGE = 1;
const PAGE_SIZE = 20;
const $ = (s)=>document.querySelector(s);

/* 漂亮版確認視窗：回傳 Promise<boolean> */
function showConfirmDialog(opts = {}){
  return new Promise((resolve)=>{
    const modal = document.getElementById('confirmModal');
    if (!modal) {
      const ok = window.confirm(opts.message || '確定要刪除此筆預約嗎？');
      return resolve(ok);
    }

    const titleEl = document.getElementById('confirmTitle');
    const msgEl   = document.getElementById('confirmMessage');
    const btnOk   = document.getElementById('confirmOk');
    const btnCancel = document.getElementById('confirmCancel');

    titleEl.textContent = opts.title || '確認刪除';
    msgEl.textContent   = opts.message || '確定要刪除此筆預約嗎？這個動作無法復原。';
    btnOk.textContent   = opts.confirmText || '確認刪除';
    btnCancel.textContent = opts.cancelText || '取消';

    const close = (result)=>{
      modal.classList.remove('is-open');
      if (typeof lockScrollForModal === 'function') lockScrollForModal(false);
      document.removeEventListener('keydown', onKey);
      btnOk.onclick = null;
      btnCancel.onclick = null;
      resolve(result);
    };

    const onKey = (e)=>{
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };

    btnOk.onclick = ()=> close(true);
    btnCancel.onclick = ()=> close(false);
    document.addEventListener('keydown', onKey);

    modal.classList.add('is-open');
    if (typeof lockScrollForModal === 'function') lockScrollForModal(true);
    setTimeout(()=>btnOk.focus(), 30);
  });
}

/* Toast：type = 'success' | 'error' */
function showToast(message, type = 'success'){
  const container = document.getElementById('toastContainer');
  if (!container){
    alert(message);
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast--error' : '');
  const icon = type === 'error' ? '⚠️' : '✅';
  el.innerHTML = `
    <span class="toast__icon">${icon}</span>
    <span class="toast__text">${message}</span>
  `;
  container.appendChild(el);

  setTimeout(()=>{
    el.style.animation = 'toast-out .18s ease-in forwards';
    setTimeout(()=>{ el.remove(); }, 200);
  }, 2200);
}



function needLogin(){ return !ADMIN_TOKEN; }

async function login(){
  return new Promise((resolve)=>{
    const modal = document.getElementById('loginModal');
    const uEl = document.getElementById('login-username');
    const pEl = document.getElementById('login-password');
    const err = document.getElementById('login-error');
    const btnSubmit = document.getElementById('login-submit');
    const btnClear = document.getElementById('login-clear');
    // init
    err.style.display = 'none';
    uEl.value = '';
    pEl.value = '';
    modal.style.display = 'flex';
    uEl.focus();

    const doSubmit = async ()=>{
      btnSubmit.disabled = true;
      err.style.display = 'none';
      const u = uEl.value.trim();
      const p = pEl.value;
      if(!u || !p){ err.textContent = "請輸入帳號與密碼"; err.style.display='block'; btnSubmit.disabled=false; return; }
      try{
        const r = await fetch(API_LOGIN, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ username:u, password:p }) });
        const j = await r.json();
        if (!r.ok){ err.textContent = j.message || j.error || "登入失敗"; err.style.display='block'; btnSubmit.disabled=false; return; }
        ADMIN_TOKEN = j.token; localStorage.setItem("admin_token", ADMIN_TOKEN);
        modal.style.display = 'none';
        resolve(true);
      }catch(e){
        err.textContent = "網路錯誤，請稍後重試"; err.style.display='block';
        btnSubmit.disabled = false;
      }
    };

    btnSubmit.onclick = doSubmit;
    btnClear.onclick = ()=>{ uEl.value=''; pEl.value=''; uEl.focus(); };
    pEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSubmit(); });
    uEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') pEl.focus(); });
  });
}
function fmtDate(d){ return new Date(d).toLocaleString(); }
function pick(obj, keys, fb=""){ for(const k of keys){ if(obj && obj[k]!=null && String(obj[k]).trim()!=="") return String(obj[k]).trim(); } return fb; }


function decodeArray(val){
  try {
    const decoded = decodeURIComponent(val || "");
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) return parsed.join(", ");
    return parsed;
  } catch (e){
    return val;
  }
}

function decodePhotoUrls(val){
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  const raw = String(val || '').trim();
  if (!raw) return [];
  const candidates = [raw];
  try { candidates.push(decodeURIComponent(raw)); } catch(e) {}
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      if (typeof parsed === 'string' && parsed) return [parsed];
    } catch(e) {}
  }
  return raw.split(/[\n,、]+/).map(s => s.trim()).filter(Boolean);
}

function renderPhotoCell(urls){
  const photos = decodePhotoUrls(urls);
  if (!photos.length) return '<span style="color:#94a3b8">—</span>';
  const first = escapeHtmlForRender(photos[0]);
  return `<div class="photo-cell"><img class="admin-photo-mini" src="${first}" alt="現場照片縮圖" loading="lazy"><div class="admin-photo-count">${photos.length} 張</div></div>`;
}

function renderPhotoSection(urls){
  const photos = decodePhotoUrls(urls);
  if (!photos.length) return '';
  return `<div class="admin-photo-grid">${photos.map((url, idx) => {
    const safeUrl = escapeHtmlForRender(url);
    return `<a class="admin-photo-link" href="${safeUrl}" target="_blank" rel="noopener"><img src="${safeUrl}" alt="現場照片 ${idx + 1}" loading="lazy"><span>照片 ${idx + 1}</span></a>`;
  }).join('')}</div>`;
}


function normalizeContext(item){
  const c = (item.context && item.context.custom) ? item.context.custom : (item.context || {});
  const m = item.metadata || {};
  const get = (names, fb="") => pick(c, names, pick(m, names, fb));
  return {
    bulk_notes: get(["bulk_notes", "大量清洗備註"]),
    group_notes: get(["group_notes", "團購備註"]),
    service_description: get(["service_description", "其他服務說明"]),
    contact_method: get(["contact_method"]),
    social_name: get(["social_name"]),
    other_contact_detail: get(["other_contact_detail"]),
    housing_type: get(["housing_type"]),
    contact_time_preference: decodeArray(get(["contact_time_preference"])),
    washer_count: get(["washer_count"]),
    washer_floor: decodeArray(get(["washer_floor"])),
    tank_count: get(["tank_count"]),
    pipe_service: get(["pipe_service"]),
    pipe_reason: decodeArray(get(["pipe_reason"])),
    name: get(["name","customer_name","fullname","姓名"]),
    phone: get(["phone","phone_number","mobile","tel","電話"]),
    service: get(["service","service_category","service_item","select_service","服務"]),
    address: get(["address","地址"]),
    brand: decodeArray(get(["ac_brand","brand","冷氣品牌"])),
    ac_type: get(["ac_type","冷氣類型"]),
    count: get(["ac_count","count","quantity","清洗數量"]),
    floor: decodeArray(get(["indoor_floor","floor","樓層","室內機所在樓層"])),
    transformer_count: get(["ac_transformer_count","變形金剛系列台數"]),
    transformer_unknown: decodeArray(get(["ac_transformer_unknown","變形金剛系列是否不清楚"])),
    antifungus: get(["anti_mold","antifungus","冷氣防霉抗菌處理"]),
    ozone: get(["ozone","臭氧殺菌消毒"]),
    ozone_room_count: get(["ozone_room_count","臭氧消毒房間數","臭氧空間消毒房間數"]),
    extra_service: get(["extra_service","其他清洗服務"]),
    line_id: get(["line_or_fb","line_id","LINE","聯絡Line"]),
    fb_name: get(["social_name","fb_name","facebook","FB","LINE & Facebook 姓名"]),
    timeslot: get(["timeslot","預約時段"]),
    date: get(["date","預約日期"]),
    note: get(["note","備註"]),
    photo_urls: decodePhotoUrls(get(["site_photo_urls","photo_urls","photos","現場照片"])),
    photo_count: get(["site_photo_count","photo_count","照片數量"]),
  };
}

/* -----------------------------
   New helper functions for client-side filtering & highlighting
   ----------------------------- */

/* escape HTML to avoid injection when inserting innerHTML */
function escapeHtmlForRender(s){
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* escape regex special chars */
function escapeRegExp(s){ return String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

/* highlight for normal text fields (name, service): case-insensitive substring highlight */
function highlightTextMatch(text, q){
  if(!q) return escapeHtmlForRender(text || '');
  const escapedQuery = String(q || '').trim();
  if(!escapedQuery) return escapeHtmlForRender(text || '');
  const re = new RegExp(escapeRegExp(escapedQuery), 'gi');
  const escapedText = escapeHtmlForRender(text || '');
  return escapedText.replace(re, (m) => `<span class="highlight">${m}</span>`);
}

/* normalize digits in a string (phone) */
function digitsOnly(s){ return String(s || '').replace(/\D/g, ''); }

/*
  highlightPhoneMatch:
  - q may contain digits; match those digits in the displayed phone string even if phone contains hyphens/spaces.
  - Approach: build a regex that allows non-digit chars between digits, e.g. '0912' -> /0\D*?9\D*?1\D*?2/gi
  - Replace matched substring in the original displayed phone string with <span class="highlight">...</span>.
*/
function highlightPhoneMatch(phoneText, q){
  const raw = String(phoneText || '');
  if(!q) return escapeHtmlForRender(raw || '');
  const qDigits = String(q).replace(/\D/g, '');
  if(!qDigits) return escapeHtmlForRender(raw || '');
  // build pattern allowing non-digit between each digit
  const pattern = qDigits.split('').map(d => escapeRegExp(d)).join('\\D*?');
  const re = new RegExp(pattern, 'gi');
  const escapedPhone = escapeHtmlForRender(raw);
  // We want to replace the matched portion(s) in the original phone text.
  // But working on escaped text: we map replacement using function on matched substring.
  return escapedPhone.replace(re, (m) => `<span class="highlight">${m}</span>`);
}

/* Main renderer: filter by name OR phone OR service.
   - q: user input
   - name match: substring (case-insensitive)
   - phone match: digits-only substring (partial digits allowed)
   - service match: substring (case-insensitive)
*/
function renderFilteredList(items){
  const q = String($("#q").value || "").trim();
  const qLower = q.toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const tbody = $("#tbl tbody");
  tbody.innerHTML = ""; // clear

  let shown = 0;
  for (const it of (items || [])){
    const ctx = normalizeContext(it);
    const name = String(ctx.name || "");
    const phone = String(ctx.phone || ctx.mobile || ctx.phone_number || "");
    const service = String(ctx.service || ctx.service_description || "");

    // decide match
    let matched = false;
    // name match (case-insensitive substring)
    if (!q) matched = true;
    else {
      if (name && name.toLowerCase().includes(qLower)) matched = true;
      // phone: compare digits only
      else if (qDigits && digitsOnly(phone).includes(qDigits)) matched = true;
      // service match (case-insensitive)
      else if (service && service.toLowerCase().includes(qLower)) matched = true;
    }

    if (!matched) continue;

    // build row
    const tr = document.createElement("tr");

    const nameCellHtml = highlightTextMatch(name || "(未填)", q);
    const phoneCellHtml = highlightPhoneMatch(phone || "", q);
    const serviceCellHtml = highlightTextMatch(service || "", q);

    const status = (it.context?.custom?.status || it.context?.status || "pending");
    tr.innerHTML = `
      <td class="td-name">${ nameCellHtml }</td>
      <td>${ phoneCellHtml }</td>
      <td>${ serviceCellHtml }</td>
      <td>${ renderPhotoCell(ctx.photo_urls) }</td>
      <td>${ escapeHtmlForRender(fmtDate(it.created_at) || "") }</td>
      <td>
        <button class="btn-status status-${status}">${statusLabel(status)}</button>
        <button class="btn-del" title="刪除" aria-label="刪除此筆預約">🗑 刪除</button>
      </td>
    `;

    // keep prior behaviors (click to open details, delete, status update)
    tr.onclick = ()=> openDetails(it);

    // delete button
    const btn = tr.querySelector('.btn-del');
    if (btn) {
      btn.addEventListener('click', async (ev)=>{
        ev.stopPropagation();
        if (btn.dataset.busy === '1') return;
        const confirmed = await showConfirmDialog({
          title: '確認刪除',
          message: '確定要刪除此筆預約嗎？這個動作無法復原。',
          confirmText: '確認刪除',
          cancelText: '取消'
        });
        if (!confirmed) return;
        btn.dataset.busy = '1';
        btn.disabled = true;

        if (typeof window.needLogin === 'function' && needLogin()) {
          const loggedIn = await (typeof window.login === 'function' ? login() : Promise.resolve(false));
          if (!loggedIn && (typeof window.needLogin === 'function' && needLogin())) {
            btn.disabled = false; btn.dataset.busy = '0';
            showToast('尚未登入或權杖失效，請先登入再刪除。', 'error');
            return;
          }
        }

        let ok = false;
        if (typeof window.handleDeleteBooking === 'function') {
          ok = await handleDeleteBooking(it, btn);
        } else {
          try {
            const url = new URL('/.netlify/functions/delete-booking', location.origin);
            url.searchParams.set('public_id', it.public_id);
            if (it.resource_type) url.searchParams.set('resource_type', it.resource_type);
            let resp = await fetch(url.toString(), {
              method: 'DELETE',
              headers: { 'x-admin-token': window.ADMIN_TOKEN || '' }
            });
            if (resp.status === 401 && typeof window.login === 'function') {
              const loggedIn = await login();
              if (loggedIn) {
                try { window.ADMIN_TOKEN = localStorage.getItem('admin_token') || window.ADMIN_TOKEN || ''; } catch(e){}
                resp = await fetch(url.toString(), {
                  method: 'DELETE',
                  headers: { 'x-admin-token': window.ADMIN_TOKEN || '' }
                });
              }
            }
            ok = resp.ok;
          } catch(e) { ok = false; }
        }

        if (ok) { tr.remove(); showToast('刪除成功', 'success'); } else {
          btn.disabled = false;
          btn.dataset.busy = '0';
          showToast('刪除失敗，請稍後再試。', 'error');
        }
      });
    }

    // status button behavior (same as original)
    const btnStatus = tr.querySelector(".btn-status");
    if (btnStatus) {
      btnStatus.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const nextStatus = {
          pending: "scheduled",
          scheduled: "done",
          done: "cancelled",
          cancelled: "pending"
        };
        let current = btnStatus.textContent.trim();
        let code = Object.keys(nextStatus).find(key => statusLabel(key) === current) || "pending";
        let newStatus = nextStatus[code];
        btnStatus.textContent = statusLabel(newStatus);
        btnStatus.className = `btn-status status-${newStatus}`;
        it.context = it.context || {};
        it.context.custom = it.context.custom || {};
        it.context.custom.status = newStatus;
        try {
          await fetch("/.netlify/functions/update-booking-context", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-token": ADMIN_TOKEN
            },
            body: JSON.stringify({
             public_id: it.public_id,
             resource_type: it.resource_type || "raw",
             type: it.type || "upload",
             context: { status: newStatus }
           })
          });
        } catch (e) {
          alert("更新狀態失敗，請稍後再試");
        }
      });
    }

    tbody.appendChild(tr);
    shown++;
  }
  $("#foot").textContent = `共 ${shown} 筆`;
}

function debounce(fn, delay){
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const runSearchFromFirstPage = debounce(() => {
  if (!ADMIN_TOKEN) return;
  doSearch({ reset: true });
}, 350);

$("#q").addEventListener("input", runSearchFromFirstPage);

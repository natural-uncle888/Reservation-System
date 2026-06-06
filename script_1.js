
function kv(label, value){ const s=(v)=>(v==null||String(v).trim()==="")?"—":String(v); return `<div class="row"><div class="k">${label}</div><div class="v">${s(value)}</div></div>`; }
function sectionCard(title, rowsHtml){ return `<div class="card fullview"><div class="card-h">${title}</div><div class="card-b">${rowsHtml}</div></div>`; }
function renderFullContent(item, mount){
  const data = normalizeContext(item);
  const blocks = [];


if (data.service === "冷氣清洗") {
  blocks.push(sectionCard("服務資訊",
    kv("服務類別", data.service) +
    kv("冷氣類型", data.ac_type) +
    kv("清洗數量", data.count) +
    kv("室內機所在樓層", data.floor) +
    kv("冷氣品牌", data.brand) +
    kv("變形金剛系列台數", data.transformer_count) +
    kv("變形金剛系列是否不清楚", data.transformer_unknown)
  ));
} 
else {
  blocks.push(sectionCard("服務資訊",
    kv("服務類別", data.service)
  ));
}

if (data.service === "團購預約清洗" || data.service === "大量清洗需求") {
  let descTitle = (data.service === "團購預約清洗") ? "團購預約說明" : "大量需求說明";
  blocks.push(sectionCard(descTitle, kv("內容", data.group_notes || data.bulk_notes)));
}


if (data.service_description) {
  blocks.push(sectionCard("其他服務說明", kv("內容", data.service_description)));
}


  if (data.service === "冷氣清洗") {
  blocks.push(sectionCard("防霉・消毒｜加購服務專區", kv("冷氣防霉抗菌處理", data.antifungus ? "需要" : "不需要") + kv("臭氧殺菌消毒", data.ozone ? "需要" : "不需要") + kv("臭氧消毒房間數", data.ozone ? data.ozone_room_count : "")));
}
if (data.service === "冷氣清洗" || data.service === "其他保養清洗") {
  blocks.push(sectionCard("其他清洗服務",
  kv("直立式洗衣機清洗（台數）", data.washer_count) +
  kv("洗衣機樓層", data.washer_floor) +
  kv("家用水塔清洗（顆數）", data.tank_count) +
  kv("自來水管清洗戶型方案", data.pipe_service) +
  kv("自來水管清洗原因", data.pipe_reason)
));
}
const photoHtml = renderPhotoSection(data.photo_urls);
if (photoHtml) {
  blocks.push(sectionCard("現場照片", photoHtml));
}
  blocks.push(sectionCard("聯繫資料",
    kv("聯絡人", data.name) +
    kv("聯絡電話", data.phone) +
    kv("與我們聯繫方式", data.contact_method) +
    kv("聯繫帳號／名稱", data.social_name) +
    kv("其他聯繫說明", data.other_contact_detail) +
    kv("居住地型態", data.housing_type) +
    kv("方便聯繫時間", data.contact_time_preference) +
    kv("地址", data.address) +
    kv("可安排時段", decodeArray(data.timeslot)) +
    kv("備註", data.note) +
    kv("建立時間", new Date(item.created_at).toLocaleString())
  ));
  mount.innerHTML = `<div class="fullview-wrap">${blocks.join("")}</div>`;
}
function statusLabel(code) {
  switch (code) {
    case "scheduled": return "已登錄";
    case "done": return "已完成";
    case "cancelled": return "已取消";
    default: return "未處理"; // pending
  }
}

function formatDateInput(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function getSelectedDateRange(){
  const preset = $("#datePreset") ? $("#datePreset").value : "all";
  const manualStart = $("#start").value.trim();
  const manualEnd = $("#end").value.trim();
  if (preset === "all") return { start: manualStart, end: manualEnd };

  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(endDate);
  if (preset === "today") {
    // same start/end date
  } else {
    startDate.setDate(startDate.getDate() - (parseInt(preset, 10) - 1));
  }
  return { start: formatDateInput(startDate), end: formatDateInput(endDate) };
}

function updatePaginationUI(){
  const info = $("#pageInfo");
  const prev = $("#prevPage");
  const next = $("#nextPage");
  if (info) info.textContent = `第 ${CURRENT_PAGE} 頁`;
  if (prev) prev.disabled = CURRENT_PAGE <= 1;
  if (next) next.disabled = !CURRENT_NEXT_CURSOR;
}

async function doSearch(options = {}){
  const reset = options.reset !== false;
  if (reset) {
    CURRENT_PAGE = 1;
    PAGE_CURSORS = [null];
    CURRENT_NEXT_CURSOR = null;
  }
  const cursor = options.cursor || PAGE_CURSORS[CURRENT_PAGE - 1] || null;
  const range = getSelectedDateRange();
  const payload = {
    q: $("#q").value.trim(),
    start: range.start,
    end: range.end,
    status: $("#statusFilter") ? $("#statusFilter").value : "all",
    max: PAGE_SIZE,
    cursor
  };
  const r = await fetch(API_LIST, { method:"POST", headers:{ "Content-Type":"application/json", "x-admin-token": ADMIN_TOKEN }, body: JSON.stringify(payload) });
  if (r.status === 401){ ADMIN_TOKEN=""; localStorage.removeItem("admin_token"); if(await login()) return doSearch(options); return; }
  const data = await r.json();
  const list = data.resources || data.items || [];
  CURRENT_LIST = list;
  CURRENT_NEXT_CURSOR = data.next_cursor || null;
  if (CURRENT_NEXT_CURSOR) PAGE_CURSORS[CURRENT_PAGE] = CURRENT_NEXT_CURSOR;

  renderFilteredList(CURRENT_LIST);
  const startNo = list.length ? ((CURRENT_PAGE - 1) * PAGE_SIZE + 1) : 0;
  const endNo = (CURRENT_PAGE - 1) * PAGE_SIZE + list.length;
  const moreText = CURRENT_NEXT_CURSOR ? "，可前往下一頁" : "，已是最後一頁";
  $("#foot").textContent = `本頁 ${list.length} 筆（第 ${startNo}–${endNo} 筆${moreText}）`;
  updatePaginationUI();
}

function openDetails(item){
  CURRENT_ITEM = item;
  const pv = $("#preview");
  if (pv) pv.innerHTML = "";
  // 點選左側列時，顯示 Cloudinary 詳細內容
  renderFullContent(item, $("#preview"));
}

$("#btnSearch").onclick = () => doSearch({ reset: true });
$("#datePreset").onchange = () => doSearch({ reset: true });
$("#statusFilter").onchange = () => doSearch({ reset: true });
$("#prevPage").onclick = () => {
  if (CURRENT_PAGE <= 1) return;
  CURRENT_PAGE--;
  doSearch({ reset: false, cursor: PAGE_CURSORS[CURRENT_PAGE - 1] || null });
};
$("#nextPage").onclick = () => {
  if (!CURRENT_NEXT_CURSOR) return;
  CURRENT_PAGE++;
  doSearch({ reset: false, cursor: CURRENT_NEXT_CURSOR });
};
$("#btnCsv").onclick = () => {
  const rows = [["姓名","電話","服務","照片數量","建立時間"]];
  for (const it of CURRENT_LIST){
    const c = normalizeContext(it);
    rows.push([c.name||"", c.phone||"", c.service||"", (c.photo_urls||[]).length || "", fmtDate(it.created_at)]);
  }
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "bookings.csv"; a.click(); URL.revokeObjectURL(a.href);
};

// paste-from-email modal
$("#btnPaste").onclick = ()=>{
  if (!CURRENT_ITEM) { alert("請先點列表選擇一筆資料"); return; }
  $("#emailPaste").value = ""; $("#emailMsg").textContent=""; $("#emailModal").style.display="flex";
};
$("#emailCancel").onclick = ()=> $("#emailModal").style.display = "none";
function escapeHtml(s){
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

$("#emailApply").onclick = async ()=>{
  const text = $("#emailPaste").value;
  const msg = $("#emailMsg");
  const lines = String(text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const kvs = {};
  for (const ln of lines){
    let m = ln.match(/^(.+?)[:：]\s*(.+)$/);
    if (!m) m = ln.match(/^(.+?)\s+(.+)$/);
    if (m){ kvs[m[1].trim()] = m[2].trim(); }
  }
  const pick = (obj, keys)=>{ for(const k of keys){ if(obj[k]!=null && String(obj[k]).trim()!=="") return String(obj[k]).trim(); } return ""; };
  const ctx = {
    name: pick(kvs, ["聯絡人","姓名","name"]),
    phone: pick(kvs, ["聯絡電話","電話","phone"]),
    service: pick(kvs, ["服務類別","服務","service"]),
    address: pick(kvs, ["地址","住址","address"]),
    ac_type: pick(kvs, ["冷氣類型","ac_type"]),
    count: pick(kvs, ["清洗數量","數量","count"]),
    floor: pick(kvs, ["室內機所在樓層","樓層","floor"]),
    brand: pick(kvs, ["冷氣品牌","brand"]),
    is_inverter: pick(kvs, ["是否為變頻機型系列","變頻","is_inverter"]),
    antifungus: pick(kvs, ["冷氣防霉抗菌處理","antifungus"]),
    ozone: pick(kvs, ["臭氧殺菌消毒","臭氧空間消毒","ozone"]),
    ozone_room_count: pick(kvs, ["臭氧消毒房間數","臭氧空間消毒房間數","ozone_room_count"]),
    extra_service: pick(kvs, ["其他清洗服務","extra_service"]),
    line_id: pick(kvs, ["LINE","LINE / Facebook","line_id"]),
    fb_name: pick(kvs, ["LINE & Facebook 姓名","facebook","fb_name"]),
    date: pick(kvs, ["預約日期","date"]),
    timeslot: pick(kvs, ["預約時段","時段","timeslot"]),
    note: pick(kvs, ["備註","note"]),
    source: pick(kvs, ["來源","subject","page_title"]),
  };
  Object.keys(ctx).forEach(k=>{ if(!ctx[k]) delete ctx[k]; });

  if (!text || !lines.length){
    msg.textContent = "沒有讀到可解析的文字，請確認貼上的是純文字內容（僅顯示，不寫回）";
    return;
  }

  // 只顯示在詳情面板（不寫回）
  const pv = $("#preview");
const toRows = (o)=> Object.keys(o).length
    ? Object.entries(o).map(([k,v]) => `<div class="row"><div class="k">${k}</div><div class="v">${escapeHtml(v)}</div></div>`).join("")
    : `<div class="row"><div class="k">解析結果</div><div class="v">（未偵測到可用欄位）</div></div>`;

  const rawCard = `
    <div class="card fullview">
      <div class="card-h">Email 原始內容（僅顯示）</div>
      <div class="card-b">
        <div class="row"><div class="k">貼上文字</div><div class="v" style="white-space:pre-wrap">${escapeHtml(text)}</div></div>
      </div>
    </div>`;

  const parsedCard = `
    <div class="card fullview">
      <div class="card-h">解析結果（未寫回）</div>
      <div class="card-b">${toRows(ctx)}</div>
    </div>`;

  pv.innerHTML = `<div class="fullview-wrap">${rawCard}${parsedCard}</div>`;

  // 提示＋關閉視窗
  msg.textContent = "已顯示在右側詳情（未寫回）";
  $("#emailModal").style.display = "none";
};

(async ()=>{ if (needLogin()){ const ok = await login(); if(!ok) return; } doSearch({ reset: true }); })();

document.getElementById("btnDelete").onclick = async () => {
  if (!CURRENT_ITEM || !CURRENT_ITEM.public_id) {
    showToast("無法刪除：找不到 public_id。", 'error');
    return;
  }

  const ok = await showConfirmDialog({
    title: '確認刪除',
    message: '是否確定要刪除此訂單？此操作無法復原！',
    confirmText: '確認刪除',
    cancelText: '取消'
  });
  if (!ok) return;

  try {
    const res = await fetch("/.netlify/functions/delete-booking?public_id=" + encodeURIComponent(CURRENT_ITEM.public_id), {
      method: "DELETE",
      headers: {
        "x-admin-token": ADMIN_TOKEN
      }
    });

    const result = await res.json();

    if (!res.ok) throw new Error(result.error || "刪除失敗");

    showToast('刪除成功', 'success');
    CURRENT_ITEM = null;
    document.getElementById("preview").innerHTML = "";
    doSearch();
  } catch (e) {
    showToast('刪除失敗：' + e.message, 'error');
  }
};

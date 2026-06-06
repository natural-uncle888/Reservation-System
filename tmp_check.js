
;

;

;

    (function(){
      const KEY = 'BOOKING_DATA';
      const form = document.getElementById('booking-form');

      function toggleOtherWrap(name){
        form.querySelectorAll('input[name="'+name+'"]').forEach(el=>{
          const id = el.dataset.otherId;
          const wrap = id && document.getElementById(id + '_wrap');
          if(wrap) wrap.style.display = el.checked ? 'block' : 'none';
        });
      }
      function collect(){
        const out = { service_category: '冷氣清洗' };
        form.querySelectorAll('input[name],select[name],textarea[name]').forEach(el=>{
          const n = el.name; if(!n) return;
          if(el.type==='radio'){
            if(!el.checked) return;
            let v = el.value || '';
            const oid = el.dataset.otherId;
            if(oid){
              const extra = (form.querySelector('#'+oid)?.value||'').trim();
              if(extra) v = v + '：' + extra;
            }
            out[n] = v;
          }else if(el.type==='checkbox'){
            if(!el.checked) return;
            let v = el.value || '';
            const oid = el.dataset.otherId;
            if(oid){
              const extra = (form.querySelector('#'+oid)?.value||'').trim();
              if(extra) v = v + '：' + extra;
            }
            (out[n]||(out[n]=[])).push(v);
          }else{
            const v = (el.value||'').trim();
            if(v) out[n] = v;
          }
        });
        return out;
      }
      function save(part){
      try{ window.BOOKING_STORAGE.save(part); }catch(e){}
    }

      // 變形金剛系列台數預設為 0，避免空白造成估價誤判。
      const transformerCountInput = document.getElementById('ac_transformer_count');
      if (transformerCountInput && transformerCountInput.value === '') {
        transformerCountInput.value = '0';
      }

      ['ac_count','indoor_floor','ac_brand'].forEach(n=>{
        form.querySelectorAll('input[name="'+n+'"]').forEach(el=>{
          el.addEventListener('change', ()=>{
            toggleOtherWrap(n);
            save(collect());
          });
        });
        toggleOtherWrap(n);
      });
      form.addEventListener('input', ()=> save(collect()));
      

      window.debugCollectAC = ()=>collect();
      window.debugLS = () => window.BOOKING_STORAGE.get();
    })();
  
;

    // 卡片選中視覺狀態（僅限 .acv2 內部）
    document.addEventListener('DOMContentLoaded', function () {
      const root = document.querySelector('.acv2');
      root.querySelectorAll('.group').forEach(function(group) {
        group.querySelectorAll('input[type="radio"],input[type="checkbox"]').forEach(function(input){
          input.addEventListener('change', function(){
            if(input.type === 'radio') { group.querySelectorAll('.option-card').forEach(function(card){ card.classList.remove('selected'); }); }
            if(input.checked) input.closest('.option-card').classList.add('selected');
            else input.closest('.option-card').classList.remove('selected');
          });
          if(input.checked) input.closest('.option-card').classList.add('selected');
        });
      });
    });
  
;

    
  
;

// === 統一：單一彈窗、依頁面順序、阻止舊邏輯干擾 ===

// 防重複彈窗 / 提交抖動
window.__ALERT_LAST_MSG__ = '';
window.__ALERT_LAST_TS__ = 0;
window.__BLOCK_SUBMIT_UNTIL__ = 0;
function showOnceAlert(msg, targetEl){
  var now = Date.now();
  if (window.__ALERT_LAST_MSG__ === msg && (now - window.__ALERT_LAST_TS__) < 2000) return;
  window.__ALERT_LAST_MSG__ = msg;
  window.__ALERT_LAST_TS__ = now;

  if (window.showValidationDialog) {
    window.showValidationDialog(msg, targetEl || null);
  } else {
    alert(msg);
    if (targetEl && targetEl.scrollIntoView) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  window.__BLOCK_SUBMIT_UNTIL__ = Date.now() + 1200;
}

// 驗證（依 DOM 出現順序）
function runValidation(){
  function requireRadio(name, label){
    var picked = document.querySelector('input[type="radio"][name="'+name+'"]:checked');
    if(!picked){
      return { ok:false, msg:'請選擇『'+label+'』', field:null };
    }
    var oid = picked && picked.dataset.otherId;
    if(oid){
      var other = document.getElementById(oid);
      if(other && !(other.value||'').trim()){
        return { ok:false, msg:'您選擇了『'+label+'』的「其他／以上」選項，請補充說明', field:other };
      }
    }
    return { ok:true, field:null };
  }

  function requireCheckbox(name, label){
    var checked = document.querySelectorAll(
      'input[type="checkbox"][name="'+name+'"]:checked,'+
      'input[type="checkbox"][name="'+name+'[]"]:checked'
    );
    if(checked.length===0){
      return { ok:false, msg:'請至少勾選一個『'+label+'』', field:null };
    }
    for(var i=0;i<checked.length;i++){
      var el = checked[i];
      var oid = el.dataset.otherId;
      if(oid){
        var other = document.getElementById(oid);
        if(other && other.offsetParent !== null && !(other.value||'').trim()){
          return { ok:false, msg:'您勾選了『'+label+'』的「其他／以上」選項，請補充說明', field:other };
        }
      }
    }
    return { ok:true, field:null };
  }

  function requireVisibleOthers(){
    var nodes = document.querySelectorAll('.other-input');
    for (var i=0;i<nodes.length;i++){
      var el = nodes[i];
      var vis = el.classList.contains('show') || el.offsetParent !== null;
      if(vis && !(el.value||'').trim()){
        return { ok:false, msg:'您選擇了需補充的「其他／以上」項目，請填寫說明', field:el };
      }
    }
    return { ok:true, field:null };
  }


  function parseIntFromText(text, fallback){
    var m = String(text || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : (fallback || 0);
  }

  function getAcTotalCount(){
    var picked = document.querySelector('input[name="ac_count"]:checked');
    if(!picked) return 0;
    if(picked.dataset && picked.dataset.otherId){
      var other = document.getElementById(picked.dataset.otherId);
      return parseIntFromText(other && other.value, parseIntFromText(picked.value, 0));
    }
    return parseIntFromText(picked.value, 0);
  }

  function requireTransformerCount(){
    var el = document.getElementById('ac_transformer_count');
    if(!el) return { ok:true, field:null };
    var raw = (el.value || '').trim();
    if(!raw) return { ok:true, field:null };
    var n = Number(raw);
    if(!Number.isInteger(n) || n < 0){
      return { ok:false, msg:'變形金剛系列台數請填 0 或正整數', field:el };
    }
    var total = getAcTotalCount();
    if(total > 0 && n > total){
      return { ok:false, msg:'變形金剛系列台數不能大於冷氣清洗總台數', field:el };
    }
    return { ok:true, field:null };
  }

  function groupRoot(name){
    var el = document.querySelector('input[name="'+name+'"], input[name="'+name+'[]"]');
    if(!el) return null;
    var sec = el.closest && el.closest('.section');
    return sec || (el.closest && el.closest('.form-row')) || el.parentElement || el;
  }

  var groups = [
    {name:'ac_type', label:'冷氣類型', type:'radio'},
    {name:'ac_count', label:'清洗數量', type:'radio'},
    {name:'indoor_floor', label:'室內機所在樓層', type:'checkbox'},
    {name:'ac_brand', label:'冷氣品牌', type:'checkbox'}
  ];
  groups.forEach(function(g){ g.root = groupRoot(g.name); });
  groups = groups.filter(function(g){ return !!g.root; });
  groups.sort(function(a,b){
    if (a.root === b.root) return 0;
    var pos = a.root.compareDocumentPosition(b.root);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  for (var i=0;i<groups.length;i++){
    var g = groups[i], r;
    if (g.type === 'radio') r = requireRadio(g.name, g.label);
    else r = requireCheckbox(g.name, g.label);
    if (!r.ok){
      return { ok:false, msg:r.msg, field: r.field || g.root };
    }
  }

  var ro = requireVisibleOthers();
  if(!ro.ok){
    return { ok:false, msg:ro.msg, field: ro.field || null };
  }

  var tc = requireTransformerCount();
  if(!tc.ok){
    return { ok:false, msg:tc.msg, field:tc.field || null };
  }

  return { ok:true, msg:'', field:null };
}

// 下一步控制
document.addEventListener('DOMContentLoaded', function(){
  var form = document.getElementById('booking-form');
  var nextBtn = document.getElementById('next');
  if(!form || !nextBtn) return;

  // click：先驗證，不過就攔截且只彈一次；通過才前進
  nextBtn.addEventListener('click', function(e){
    var res = runValidation();
    if(!res.ok){
      e.preventDefault(); e.stopImmediatePropagation();
      showOnceAlert(res.msg, res.field);
      return false;
    } else {
      e.preventDefault(); e.stopImmediatePropagation();
      // 正確前往 data-next-href 或提交
      var href = nextBtn.getAttribute('data-next-href') || nextBtn.getAttribute('href');
      if (href && href !== '#') window.location.href = href;
      else if (form.requestSubmit) form.requestSubmit();
      else form.submit();
      return false;
    }
  }, true); // capture 先於其他監聽執行

  // 全域 submit 捕獲：任何提交路徑都必須通過驗證
  document.addEventListener('submit', function(e){
    var f = e.target;
    if (!f || f.id !== 'booking-form') return;

    if (Date.now() < (window.__BLOCK_SUBMIT_UNTIL__ || 0)) {
      e.preventDefault(); e.stopImmediatePropagation();
      return false;
    }
    var res = runValidation();
    if(!res.ok){
      e.preventDefault(); e.stopImmediatePropagation();
      showOnceAlert(res.msg, res.field);
      return false;
    }
  }, true);
});

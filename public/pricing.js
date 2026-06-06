(function(){
  'use strict';

  var DEFAULT_PRICES = {
    acSplit: 1800,
    acSplitBulk: 1500,
    acCeiling: 2800,
    acTransformer: 500,
    antiMold: 300,
    antiMoldBulk: 250,
    ozone: 200,
    washer: 2000,
    washerWithAc: 1800,
    tank: 1000,
    tankWithPipe: 800,
    pipeBaseNoKitchenOneBath: 3200,
    pipeBaseOneKitchenOneBath: 4200,
    pipeExtraBathOrKitchen: 500
  };

  var PRICES = Object.assign({}, DEFAULT_PRICES);
  var PRICING_API = "/.netlify/functions/get-pricing";

  function applyPrices(next){
    if(!next || typeof next !== "object") return;
    Object.keys(DEFAULT_PRICES).forEach(function(key){
      var n = Number(next[key]);
      if(Number.isFinite(n) && n >= 0) PRICES[key] = n;
    });
  }

  function loadRemotePrices(){
    if(!window.fetch) return Promise.resolve(PRICES);
    return fetch(PRICING_API, { cache: "no-store" })
      .then(function(res){ return res.ok ? res.json() : null; })
      .then(function(data){
        if(data && data.prices) {
          applyPrices(data.prices);
          refreshAll();
        }
        return PRICES;
      })
      .catch(function(){ return PRICES; });
  }

  function money(n){
    return '$' + Number(n || 0).toLocaleString('zh-TW');
  }

  function hasValue(v){
    return !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
  }

  function asText(v){
    if (Array.isArray(v)) return v.join('、');
    return String(v || '');
  }

  function parseQty(v, fallback){
    var text = asText(v);
    var m = text.match(/\d+/);
    if (m) return Number(m[0]);
    var zh = { '零':0, '一':1, '二':2, '兩':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10 };
    for (var key in zh) {
      if (text.indexOf(key) >= 0) return zh[key];
    }
    return fallback || 0;
  }

  function readCurrentForm(){
    var out = {};
    document.querySelectorAll('input[name],select[name],textarea[name]').forEach(function(el){
      var n = el.name;
      if(!n) return;
      if(el.type === 'radio'){
        if(!el.checked) return;
        out[n] = el.value || '';
      }else if(el.type === 'checkbox'){
        if(!el.checked) return;
        var v = el.value || '';
        if(!out[n]) out[n] = [];
        out[n].push(v);
      }else{
        var val = (el.value || '').trim();
        if(val) out[n] = val;
      }
    });
    return out;
  }

  function readStoredData(){
    var path = (location.pathname || '').toLowerCase();

    // 只有成功頁才讀取 BOOKING_SUCCESS_DATA。
    // 其他預約填寫頁若優先讀取成功資料，會把上一筆已送出的估價帶進來，
    // 造成 final-booking 的「即時預估金額」與上方預覽金額不一致。
    if(path.indexOf('booking-success') >= 0){
      try{
        var success = JSON.parse(localStorage.getItem('BOOKING_SUCCESS_DATA') || '{}');
        if(success && Object.keys(success).length) return success;
      }catch(e){}
    }

    try{
      return window.BOOKING_STORAGE ? window.BOOKING_STORAGE.get() : {};
    }catch(e){
      return {};
    }
  }

  function getMergedData(seed){
    return Object.assign({}, readStoredData(), seed || {}, readCurrentForm());
  }

  function calculate(seed){
    var data = getMergedData(seed);
    var items = [];
    var notes = [];
    var total = 0;

    function add(label, qty, unit, subtotal, note){
      if(!qty || qty < 0) return;
      items.push({ label: label, qty: qty, unitPrice: unit, subtotal: subtotal, note: note || '' });
      total += Number(subtotal || 0);
    }

    var acType = asText(data.ac_type);
    var acQty = parseQty(data.ac_count, 0);
    if(asText(data.ac_count).indexOf('以上') >= 0 && !data.ac_count_other){
      acQty = Math.max(acQty, 5);
      notes.push('冷氣「5台以上」目前先以 5 台估算，實際台數會再確認。');
    }
    if(data.ac_count_other) acQty = parseQty(data.ac_count_other, acQty);

    var hasAc = acQty > 0 && !!acType;
    if(hasAc){
      if(acType.indexOf('吊隱') >= 0){
        add('吊隱式冷氣清洗', acQty, PRICES.acCeiling, acQty * PRICES.acCeiling);
      }else{
        var unit = acQty >= 3 ? PRICES.acSplitBulk : PRICES.acSplit;
        add('分離式冷氣清洗' + (acQty >= 3 ? '（三台以上優惠）' : ''), acQty, unit, acQty * unit);
      }
      var transformerQty = parseQty(data.ac_transformer_count, 0);
      if(transformerQty > 0){
        if(transformerQty > acQty){
          notes.push('變形金剛系列台數大於冷氣總台數，估價先以冷氣總台數 ' + acQty + ' 台計算。');
          transformerQty = acQty;
        }
        add('變形金剛系列加價', transformerQty, PRICES.acTransformer, transformerQty * PRICES.acTransformer);
      }
      if(hasValue(data.ac_transformer_unknown) || asText(data.ac_transformer_series).indexOf('不清楚') >= 0){
        notes.push('變形金剛系列、富士通一體式水盤、室內機加長費等加價項目，會由人員確認。');
      }
    }

    if(hasValue(data.anti_mold)){
      var moldQty = acQty || 1;
      var moldUnit = moldQty >= 5 ? PRICES.antiMoldBulk : PRICES.antiMold;
      add('冷氣防黴處理' + (moldQty >= 5 ? '（滿五台優惠）' : ''), moldQty, moldUnit, moldQty * moldUnit);
    }

    if(hasValue(data.ozone)){
      var ozoneQty = parseQty(data.ozone_room_count, 0);
      if(ozoneQty > 0){
        add('臭氧全面消毒（可密閉房間）', ozoneQty, PRICES.ozone, ozoneQty * PRICES.ozone, '以可關門密閉的房間數計算。');
      }else{
        notes.push('臭氧消毒需填寫可密閉房間數，才會納入即時估價。');
      }
      notes.push('臭氧消毒需要密閉空間，通常以房間為主；客廳、餐廳、開放式廚房等開放式空間通常不建議或無法施作。');
    }

    var washerQty = parseQty(data.washer_count, 0);
    if(washerQty > 0){
      var washerUnit = hasAc ? PRICES.washerWithAc : PRICES.washer;
      add('直立式洗衣機清洗' + (hasAc ? '（搭配冷氣優惠）' : ''), washerQty, washerUnit, washerQty * washerUnit);
    }

    var tankQty = parseQty(data.tank_count, 0);
    var pipeText = asText(data.pipe_service);
    var hasPipe = !!pipeText;
    if(tankQty > 0){
      var tankUnit = hasPipe ? PRICES.tankWithPipe : PRICES.tank;
      add('家用水塔清洗' + (hasPipe ? '（搭配水管優惠）' : ''), tankQty, tankUnit, tankQty * tankUnit);
    }

    if(hasPipe){
      var pipeSubtotal = 0;
      if(pipeText.indexOf('無廚一衛') >= 0){
        pipeSubtotal = PRICES.pipeBaseNoKitchenOneBath;
      }else{
        var baths = parseQty(pipeText.replace(/一廚/, ''), 1);
        pipeSubtotal = PRICES.pipeBaseOneKitchenOneBath + Math.max(0, baths - 1) * PRICES.pipeExtraBathOrKitchen;
      }
      add('自來水管清洗保養（' + pipeText + '）', 1, pipeSubtotal, pipeSubtotal);
      notes.push('水管清洗若有額外迴路、五樓以上樓層或特殊環境，會再由人員確認。');
    }

    var category = asText(data.service_category || data.service || '');
    if(category.indexOf('團購') >= 0 || hasValue(data.group_notes)){
      notes.push('團購預約會依戶數、台數與同區域安排另行確認報價。');
    }
    if(category.indexOf('大量') >= 0 || hasValue(data.bulk_notes)){
      notes.push('大量清洗需求會依數量、地點與施工條件另行確認報價。');
    }

    return { items: items, total: total, notes: notes, hasEstimate: items.length > 0 };
  }

  function render(target, seed){
    var result = calculate(seed);
    if(!target) return result;
    var html = '<div class="estimate-title"><span>即時預估金額</span><strong>' + money(result.total) + '</strong></div>';
    if(!result.items.length){
      html += '<p class="estimate-empty">選擇服務項目與數量後，這裡會自動顯示初步估算。</p>';
    }else{
      html += '<ul class="estimate-list">';
      result.items.forEach(function(item){
        html += '<li><div><b>' + item.label + '</b><small>' + item.qty + ' × ' + money(item.unitPrice) + (item.note ? '｜' + item.note : '') + '</small></div><strong>' + money(item.subtotal) + '</strong></li>';
      });
      html += '</ul>';
    }
    html += '<p class="estimate-note">此為線上初步估算，實際金額會依設備型號、現場環境、加價條款與服務範圍由專人確認。</p>';
    if(result.notes.length){
      html += '<ul class="estimate-notes">' + result.notes.map(function(n){ return '<li>' + n + '</li>'; }).join('') + '</ul>';
    }
    target.innerHTML = html;
    return result;
  }

  function injectStyles(){
    if(document.getElementById('pricing-estimate-style')) return;
    var style = document.createElement('style');
    style.id = 'pricing-estimate-style';
    style.textContent = '.estimate-card{margin:22px 0;padding:18px;border-radius:18px;background:#fffdf7;border:1px solid #eadfc9;box-shadow:0 8px 24px rgba(80,60,20,.08)}.estimate-title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:18px;font-weight:800;color:#3a2a14}.estimate-title strong{font-size:24px;color:#8a5a10}.estimate-empty{margin:12px 0 0;color:#7a6a54}.estimate-list{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:10px}.estimate-list li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px dashed #eadfc9}.estimate-list b{display:block;color:#3f2f19}.estimate-list small{display:block;margin-top:3px;color:#7b6a55}.estimate-list li>strong{white-space:nowrap;color:#3f2f19}.estimate-note{margin:14px 0 0;font-size:13px;line-height:1.6;color:#7a5b2c}.estimate-notes{margin:8px 0 0;padding-left:20px;font-size:13px;line-height:1.6;color:#7a5b2c}@media (min-width:900px){.estimate-card{max-width:760px}}';
    document.head.appendChild(style);
  }

  function refreshAll(seed){
    document.querySelectorAll('[data-estimate-card]').forEach(function(el){ render(el, seed); });
  }

  function init(){
    injectStyles();
    refreshAll();
    loadRemotePrices();
    document.addEventListener('input', function(){ refreshAll(); });
    document.addEventListener('change', function(){ setTimeout(function(){ refreshAll(); }, 0); });
  }

  window.BOOKING_PRICING = {
    PRICES: PRICES,
    DEFAULT_PRICES: DEFAULT_PRICES,
    loadRemotePrices: loadRemotePrices,
    calculate: calculate,
    render: render,
    refreshAll: refreshAll,
    money: money
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

(function(){
  'use strict';

  var API = '/.netlify/functions/get-extra-services';
  var SERVICE_PROMISE = null;
  var STYLE_ID = 'extra-services-style';

  function asArray(value){
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch(e) { return []; }
    }
    return [];
  }

  function numberOr(value, fallback){
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeSelection(raw){
    if (!raw || typeof raw !== 'object') return null;
    var id = String(raw.id || '').trim();
    var name = String(raw.name || '').trim();
    var category = String(raw.category || '').trim();
    if (!id || !name || !category) return null;
    var pricingType = ['fixed','starting','quote'].indexOf(raw.pricing_type) >= 0 ? raw.pricing_type : 'quote';
    var quantity = Math.max(1, Math.round(numberOr(raw.quantity, 1)));
    var price = pricingType === 'quote' ? 0 : Math.max(0, Math.round(numberOr(raw.price, 0)));
    return {
      id: id,
      name: name,
      category: category,
      description: String(raw.description || '').trim(),
      unit: String(raw.unit || '項').trim() || '項',
      pricing_type: pricingType,
      price: price,
      quantity: quantity,
      subtotal: pricingType === 'quote' ? 0 : price * quantity
    };
  }

  function normalizeSelections(value){
    return asArray(value).map(normalizeSelection).filter(Boolean);
  }

  function readBooking(){
    try { return window.BOOKING_STORAGE ? window.BOOKING_STORAGE.get() : {}; }
    catch(e) { return {}; }
  }

  function writeCategorySelections(category, selected){
    if (!window.BOOKING_STORAGE) return;
    var booking = readBooking();
    var prev = normalizeSelections(booking.extra_services);
    var keep = prev.filter(function(item){ return item.category !== category; });
    var next = keep.concat(selected.map(normalizeSelection).filter(Boolean));
    // 尚未使用任何動態服務時，不額外寫入 empty extra_services，讓既有訂單 payload 保持原樣。
    if (!prev.length && !next.length && booking.extra_services == null) return;
    window.BOOKING_STORAGE.save({ extra_services: next });
    try { window.dispatchEvent(new CustomEvent('booking-extra-services-change', { detail: { extra_services: next } })); } catch(e) {}
  }

  function money(value){ return 'NT$' + Number(value || 0).toLocaleString('zh-TW'); }

  function priceLabel(service){
    if (service.pricing_type === 'quote') return '價格由專人確認';
    if (service.pricing_type === 'starting') return money(service.price) + ' 起 / ' + service.unit;
    return money(service.price) + ' / ' + service.unit;
  }

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.extra-services-block{margin-top:22px}',
      '.extra-services-heading{margin:0 0 8px;font-size:1.12rem;font-weight:700;color:var(--brand,#2563eb);line-height:1.45}',
      '.extra-services-intro{margin:0 0 12px;color:var(--muted,#6b7280);font-size:.98rem;line-height:1.6}',
      '.extra-services-list{display:grid;gap:12px}',
      '.extra-service-card{border:2px solid var(--line,#e5e7eb);border-radius:18px;background:#fff;padding:14px 15px;box-shadow:0 2px 8px rgba(0,0,0,.04);transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}',
      '.extra-service-card.is-selected{border-color:var(--brand,#2563eb);background:#eef2ff;box-shadow:0 4px 12px rgba(37,99,235,.12)}',
      '.extra-service-main{display:flex;gap:12px;align-items:flex-start;cursor:pointer}',
      '.extra-service-main input[type="checkbox"]{width:22px!important;height:22px!important;min-width:22px;min-height:22px;margin:0 6px 0 0!important;flex:0 0 auto}',
      '.extra-service-copy{min-width:0;flex:1}',
      '.extra-service-name{display:block;font-size:1.12rem;font-weight:700;color:var(--brand,#2563eb);line-height:1.45}',
      '.extra-service-desc{display:block;margin-top:6px;color:var(--muted,#6b7280);font-size:.98rem;line-height:1.6;overflow-wrap:anywhere;word-break:break-word}',
      '.extra-service-desc p,.extra-service-desc div{margin:.18em 0}.extra-service-desc ul,.extra-service-desc ol{margin:.35em 0;padding-left:1.55em}.extra-service-desc li{margin:.12em 0}',
      '.extra-service-desc span{display:inline!important;min-width:0!important;overflow:visible!important;text-overflow:clip!important;white-space:inherit!important;-webkit-line-clamp:unset!important;-webkit-box-orient:initial!important}',
      '.extra-service-price{display:block;margin-top:8px;color:#dc2626;font-size:1.05rem;font-weight:700;line-height:1.5}',
      '.extra-service-qty-wrap{display:none;margin-top:12px;padding-top:12px;border-top:1px dashed #d1d5db;align-items:center;gap:10px;flex-wrap:wrap}',
      '.extra-service-card.is-selected .extra-service-qty-wrap{display:flex}',
      '.extra-service-qty-wrap label{font-size:.98rem;font-weight:700;color:#475569}',
      '.extra-service-qty{width:92px;height:40px;border:1px solid #cbd5e1;border-radius:10px;padding:0 10px;font-size:1rem;background:#fff}',
      '.extra-service-unit{font-size:.98rem;color:var(--muted,#6b7280)}',
      '.extra-service-qty-hint{width:100%;font-size:.88rem;line-height:1.45;color:var(--muted,#6b7280)}',
      '.extra-service-card.is-unavailable{opacity:.68;background:#f8fafc}',
      '.extra-service-card.is-unavailable .extra-service-main{cursor:not-allowed}',
      '.extra-service-card.is-unavailable .extra-service-name{color:#64748b}',
      '@media(max-width:640px){.extra-service-card{padding:13px 14px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function loadServices(){
    if (SERVICE_PROMISE) return SERVICE_PROMISE;
    SERVICE_PROMISE = fetch(API, { cache:'no-store' })
      .then(function(res){ return res.ok ? res.json() : { services:[] }; })
      .then(function(data){ return Array.isArray(data && data.services) ? data.services : []; })
      .catch(function(){ return []; });
    return SERVICE_PROMISE;
  }

  function parsePositiveInt(value){
    var matches = String(value == null ? '' : value).match(/\d+/g);
    if (!matches || !matches.length) return 0;
    var n = Number(matches[matches.length - 1]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function getAcBookingCount(){
    var booking = readBooking();
    var direct = parsePositiveInt(booking.ac_count_other);
    if (direct > 0) return direct;
    var named = parsePositiveInt(booking.ac_count);
    if (named > 0) return named;
    var serviceName = String(booking.service_category || booking.service || '');
    return /冷氣/.test(serviceName) ? parsePositiveInt(booking.count || booking.quantity) : 0;
  }

  function quantityLimitType(service){
    var type = String(service && service.quantity_limit_type || '').trim();
    return ['fixed','ac_count','unlimited'].indexOf(type) >= 0 ? type : 'fixed';
  }

  function resolvedQuantityMax(service){
    var type = quantityLimitType(service);
    if (type === 'ac_count') return getAcBookingCount();
    if (type === 'unlimited') return 99; // 系統安全上限；前台不顯示為固定上限。
    return Math.max(1, Math.min(99, Math.round(numberOr(service && service.max_quantity, 20))));
  }

  function snapshot(service, quantity){
    var max = resolvedQuantityMax(service);
    var q = Math.max(1, Math.min(Math.max(1, max || 1), Math.round(numberOr(quantity, 1))));
    var pricingType = ['fixed','starting','quote'].indexOf(service.pricing_type) >= 0 ? service.pricing_type : 'quote';
    var price = pricingType === 'quote' ? 0 : Math.max(0, Math.round(numberOr(service.price, 0)));
    return normalizeSelection({
      id: service.id,
      name: service.name,
      category: service.category,
      description: service.description || '',
      unit: service.unit || '項',
      pricing_type: pricingType,
      price: price,
      quantity: q,
      subtotal: pricingType === 'quote' ? 0 : price * q
    });
  }

  function renderContainer(container, category, services){
    var list = services.filter(function(service){ return service && service.enabled !== false && service.category === category; });
    if (!list.length) {
      container.innerHTML = '';
      container.hidden = true;
      // If a category has no active services anymore, remove its stale in-progress selections.
      writeCategorySelections(category, []);
      return;
    }
    ensureStyle();
    var stored = normalizeSelections(readBooking().extra_services);
    var storedById = {};
    stored.filter(function(item){ return item.category === category; }).forEach(function(item){ storedById[item.id] = item; });
    var title = container.getAttribute('data-extra-services-title') || (category === 'ac_addon' ? '其他冷氣加購' : '其他可加選服務');
    var intro = container.getAttribute('data-extra-services-intro') || (category === 'ac_addon' ? '有需要直接點選服務即可，再點一次可取消；不加購也能繼續預約。' : '有需要直接點選服務即可，再點一次可取消；不加選也能繼續預約。');
    container.hidden = false;
    container.className = (container.className + ' extra-services-block').trim();
    container.innerHTML = '<h2 class="extra-services-heading"></h2><p class="extra-services-intro"></p><div class="extra-services-list"></div>';
    container.querySelector('.extra-services-heading').textContent = title;
    container.querySelector('.extra-services-intro').textContent = intro;
    var listBox = container.querySelector('.extra-services-list');

    list.forEach(function(service){
      var old = storedById[service.id];
      var card = document.createElement('div');
      card.className = 'extra-service-card option-card' + (old ? ' is-selected selected' : '');
      card.setAttribute('data-extra-service-id', service.id);
      card.innerHTML = '<label class="extra-service-main">' +
        '<input type="checkbox" data-extra-service-toggle>' +
        '<span class="extra-service-copy"><span class="extra-service-name"></span><span class="extra-service-desc"></span><span class="extra-service-price"></span></span>' +
        '</label>' +
        '<div class="extra-service-qty-wrap"><label>數量</label><input class="extra-service-qty" data-extra-service-qty type="number" min="1" step="1" inputmode="numeric"><span class="extra-service-unit"></span><span class="extra-service-qty-hint" data-extra-service-qty-hint></span></div>';
      card.querySelector('.extra-service-name').textContent = service.name || '';
      var desc = card.querySelector('.extra-service-desc');
      if (service.description_html) desc.innerHTML = service.description_html;
      else desc.textContent = service.description || '';
      desc.style.display = (service.description_html || service.description) ? 'block' : 'none';
      card.querySelector('.extra-service-price').textContent = priceLabel(service);
      card.querySelector('.extra-service-unit').textContent = service.unit || '項';
      var toggle = card.querySelector('[data-extra-service-toggle]');
      var qty = card.querySelector('[data-extra-service-qty]');
      var qtyHint = card.querySelector('[data-extra-service-qty-hint]');
      var max = resolvedQuantityMax(service);
      var ruleType = quantityLimitType(service);
      var unavailable = ruleType === 'ac_count' && max < 1;
      if (ruleType === 'unlimited') qty.removeAttribute('max');
      else qty.max = String(Math.max(1, max));
      qty.value = String(Math.max(1, Math.min(Math.max(1, max || 1), old ? old.quantity : 1)));
      toggle.checked = !!old && !unavailable;
      toggle.disabled = unavailable;
      qty.disabled = unavailable;
      card.classList.toggle('is-unavailable', unavailable);
      if (qtyHint) {
        if (ruleType === 'ac_count') qtyHint.textContent = unavailable ? '需先完成冷氣清洗台數選擇。' : ('最多可選 ' + max + (service.unit || '項') + '（依冷氣清洗 ' + max + ' 台）');
        else if (ruleType === 'fixed') qtyHint.textContent = '最多可選 ' + max + (service.unit || '項');
        else qtyHint.textContent = '';
        qtyHint.style.display = qtyHint.textContent ? 'block' : 'none';
      }
      listBox.appendChild(card);

      function syncCard(){ card.classList.toggle('is-selected', toggle.checked); card.classList.toggle('selected', toggle.checked); }
      function saveAll(){
        var selected = [];
        listBox.querySelectorAll('[data-extra-service-id]').forEach(function(row){
          var id = row.getAttribute('data-extra-service-id');
          var svc = list.find(function(item){ return item.id === id; });
          var cb = row.querySelector('[data-extra-service-toggle]');
          var qEl = row.querySelector('[data-extra-service-qty]');
          if (svc && cb && cb.checked) selected.push(snapshot(svc, qEl ? qEl.value : 1));
        });
        writeCategorySelections(category, selected);
      }
      toggle.addEventListener('change', function(){ syncCard(); saveAll(); });
      qty.addEventListener('input', function(){
        var currentMax = resolvedQuantityMax(service);
        var value = Math.max(1, Math.round(numberOr(qty.value, 1)));
        if (quantityLimitType(service) !== 'unlimited') value = Math.min(Math.max(1, currentMax || 1), value);
        else value = Math.min(99, value);
        if (String(value) !== qty.value) qty.value = String(value);
        saveAll();
      });
      qty.addEventListener('change', function(){
        var currentMax = resolvedQuantityMax(service);
        var limit = quantityLimitType(service) === 'unlimited' ? 99 : Math.max(1, currentMax || 1);
        qty.value = String(Math.max(1, Math.min(limit, Math.round(numberOr(qty.value, 1)))));
        saveAll();
      });
    });

    // Refresh snapshots against the latest service name/price while preserving quantities.
    var initialSelected = [];
    listBox.querySelectorAll('[data-extra-service-id]').forEach(function(row){
      var cb = row.querySelector('[data-extra-service-toggle]');
      if (!cb || !cb.checked) return;
      var service = list.find(function(item){ return item.id === row.getAttribute('data-extra-service-id'); });
      if (service) initialSelected.push(snapshot(service, row.querySelector('[data-extra-service-qty]').value));
    });
    writeCategorySelections(category, initialSelected);
  }

  function formatSelection(item){
    var normalized = normalizeSelection(item);
    if (!normalized) return '';
    var text = normalized.name + ' × ' + normalized.quantity + normalized.unit;
    if (normalized.pricing_type === 'quote') return text + '（價格另行確認）';
    if (normalized.pricing_type === 'starting') return text + '（' + money(normalized.price) + ' 起 / ' + normalized.unit + '）';
    return text + '（' + money(normalized.price) + ' / ' + normalized.unit + '）';
  }

  function updateHomeLabels(services){
    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-extra-services-home-other]'));
    if (!targets.length) return;
    var names = services.filter(function(service){ return service && service.enabled !== false && service.category === 'other_service'; })
      .map(function(service){ return String(service.name || '').trim(); }).filter(Boolean);
    targets.forEach(function(target){
      var base = target.getAttribute('data-base-label') || target.textContent || '';
      if (!target.getAttribute('data-base-label')) target.setAttribute('data-base-label', base);
      if (!names.length) { target.textContent = base; return; }
      var shown = names.slice(0, 3);
      target.textContent = base + '・' + shown.join('・') + (names.length > shown.length ? '等' : '');
    });
  }

  function init(){
    var containers = Array.prototype.slice.call(document.querySelectorAll('[data-extra-services-category]'));
    var homeTargets = Array.prototype.slice.call(document.querySelectorAll('[data-extra-services-home-other]'));
    if (!containers.length && !homeTargets.length) return;
    loadServices().then(function(services){
      containers.forEach(function(container){ renderContainer(container, container.getAttribute('data-extra-services-category'), services); });
      updateHomeLabels(services);
    });
  }

  window.EXTRA_SERVICES = {
    load: loadServices,
    normalizeSelections: normalizeSelections,
    formatSelection: formatSelection,
    money: money,
    refresh: init
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

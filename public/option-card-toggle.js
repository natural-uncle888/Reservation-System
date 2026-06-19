(function(){
  function getInput(card){
    if(!card) return null;
    return card.querySelector('input[type="radio"], input[type="checkbox"]');
  }

  function syncCard(input){
    if(!input) return;
    var card = input.closest('.option-card');
    if(!card) return;
    if(input.checked) card.classList.add('selected');
    else card.classList.remove('selected');
  }

  function syncGroup(input){
    if(!input) return;
    var group = input.closest('.group, .option-grid, .time-grid, .contact-method-grid, form, body');
    if(input.type === 'radio' && input.name && group){
      group.querySelectorAll('input[type="radio"]').forEach(function(radio){ if(radio.name === input.name) syncCard(radio); });
    }else{
      syncCard(input);
    }
  }

  function syncAll(root){
    (root || document).querySelectorAll('label.option-card input[type="radio"], label.option-card input[type="checkbox"], .option-card input[type="radio"], .option-card input[type="checkbox"]').forEach(syncCard);
  }

  document.addEventListener('pointerdown', function(e){
    var card = e.target.closest && e.target.closest('label.option-card, .option-card');
    var input = getInput(card);
    if(!input) return;
    input.dataset.wasCheckedBeforeCardClick = input.checked ? '1' : '0';
  }, true);

  document.addEventListener('click', function(e){
    var input = e.target.closest && e.target.closest('input[type="radio"], input[type="checkbox"]');
    if(!input || !input.closest('.option-card')) return;

    // 原生 radio 不能再點一次取消；這裡統一成「已選後再點一次可取消」。
    if(input.type === 'radio' && input.dataset.wasCheckedBeforeCardClick === '1'){
      e.preventDefault();
      e.stopPropagation();
      setTimeout(function(){
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles:true }));
        input.dispatchEvent(new Event('input', { bubbles:true }));
        syncGroup(input);
      }, 0);
      return;
    }

    setTimeout(function(){ syncGroup(input); }, 0);
  }, true);

  document.addEventListener('change', function(e){
    var input = e.target && e.target.matches && e.target.matches('input[type="radio"], input[type="checkbox"]') ? e.target : null;
    if(input && input.closest('.option-card')) syncGroup(input);
  }, true);

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ syncAll(document); });
  }else{
    syncAll(document);
  }
})();

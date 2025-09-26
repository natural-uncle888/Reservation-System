// kill-legacy.js — force-disable legacy UI behaviors even if old JS/CSS were cached
(function () {
  // 1) Step progress bar
  window.makeProgress = function(){};
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('.progress').forEach(el => el.remove());
  }, {once:true});

  // 2) Autosave / restore
  window.restoreFields = function(){};
  window.injectSaveBanner = function(){};
  try { localStorage.removeItem('BOOKING_DATA'); } catch(e){}

  // 3) Confirm-before-submit
  window.confirmBeforeSubmit = function(){};
  document.addEventListener('submit', function(e){
    if (typeof window.confirm === 'function') {
      const orig = window.confirm;
      window.confirm = () => true;
      setTimeout(() => (window.confirm = orig), 0);
    }
  }, true);
})();
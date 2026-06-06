
  // 1) 模態開關時鎖定背景捲動
  function lockScrollForModal(open){
    document.body.classList.toggle('body--modal-open', !!open);
  }

  // 2) 表格列支援 Enter/Space 觸發 click（無障礙）
  document.addEventListener('keydown', (e)=>{
    const tr = e.target && e.target.closest && e.target.closest('tr[tabindex="0"]');
    if(!tr) return;
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      tr.click();
    }
  });

  // 3) 自動為表格列加 tabindex="0"，初次與動態新增都會套用
  function enhanceRowsTabIndex(){
    document.querySelectorAll('table#tbl tbody tr').forEach(tr=>{
      if(!tr.hasAttribute('tabindex')) tr.setAttribute('tabindex','0');
    });
  }
  const mo = new MutationObserver(enhanceRowsTabIndex);
  window.addEventListener('DOMContentLoaded', ()=>{
    enhanceRowsTabIndex();
    const tbody = document.querySelector('table#tbl tbody');
    if(tbody) mo.observe(tbody, {childList:true, subtree:true});
  });

  // 4) iOS：輸入框聚焦時，避免被鍵盤遮住
  const autoScrollInputs = ['INPUT','TEXTAREA'];
  document.addEventListener('focusin', (e)=>{
    if(autoScrollInputs.includes(e.target.tagName)){
      setTimeout(()=>{ e.target.scrollIntoView({block:'center'}); }, 100);
    }
  });

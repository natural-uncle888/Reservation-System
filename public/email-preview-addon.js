(function(){
  function hideRightPaneExtras(){
    try{
      var title = document.getElementById('dv-title'); if (title) title.style.display = 'none';
      var btn = document.getElementById('btnPaste'); if (btn) (btn.parentElement ? (btn.parentElement.style.display='none') : (btn.style.display='none'));
      var detailsList = document.querySelectorAll('details'); detailsList.forEach(function(d){ d.style.display = 'none'; });
      var prev = document.getElementById('preview'); if (prev) prev.style.display = 'none';
    }catch(e){ console.warn('hideRightPaneExtras err', e); }
  }
  function ensureEmailIframe(){
    var host = document.getElementById('emailPreviewHost');
    if (!host) {
      var prev = document.getElementById('preview');
      host = document.createElement('div'); host.id='emailPreviewHost'; host.className='panel'; host.style.marginTop='0';
      host.innerHTML = "<iframe id='emailPreview' sandbox='' style='width:100%;height:76vh;border:0;border-radius:12px;background:#fff;'></iframe>";
      if (prev && prev.parentNode) prev.parentNode.insertBefore(host, prev.nextSibling); else document.body.appendChild(host);
    }
    return document.getElementById('emailPreview');
  }
  function renderEmailToRightPane(htmlOrText){
    try{
      var iframe=document.getElementById('emailPreview'); if(!iframe) return;
      iframe.removeAttribute('src');
      var isHtml=/<\\/?[a-z][\\s\\S]*>/i.test((htmlOrText||""));
      var html=isHtml?String(htmlOrText||""):"<pre style='white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;padding:16px;margin:0;'>"+String(htmlOrText||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</pre>";
      iframe.srcdoc="<!doctype html><html><head><meta charset='utf-8'></head><body>"+html+"</body></html>";
    }catch(e){console.warn("renderEmailToRightPane err",e);}
  }
  function buildFromCtx(ctx){
    function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
    function row(k,v){v=esc(v);if(!v)return"";return"<tr><th style='text-align:left;width:160px;padding:8px;border-bottom:1px solid #e5e7eb;color:#111827;'>"+esc(k)+"</th><td style='padding:8px;border-bottom:1px solid #e5e7eb;color:#111827;'>"+v+"</td></tr>"};
    function section(t,rows){if(!rows)return"";return"<div style='margin:18px 0;padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;'><div style='font-weight:700;margin-bottom:8px;color:#111827'>"+esc(t)+"</div><table style='width:100%;border-collapse:collapse'>"+rows+"</table></div>";}
    var rowsBasic=row("姓名",ctx.name||ctx.customer_name)+row("電話",ctx.phone||ctx.phone_number||ctx.tel)+row("地址",ctx.address)+row("地區",ctx.area||ctx.city||ctx.region)+row("來源",ctx.source||ctx.page_title||ctx.page)+row("預約日期",ctx.date)+row("預約時段",ctx.timeslot||ctx.time);
    var rowsSvc=row("服務類別",ctx.service||ctx.service_category||ctx.service_item)+row("冷氣類型",ctx.ac_type)+row("清洗數量",ctx.count||ctx.ac_count)+row("室內機所在樓層",ctx.floor||ctx.indoor_floor)+row("冷氣品牌",ctx.ac_brand)+row("Brevo Message ID",ctx.brevo_msg_id);
    var rowsOther=row("備註",ctx.note);
    return "<!doctype html><html><head><meta charset='utf-8'></head><body style='background:#f8fafc;padding:16px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'>"+section("基本資料",rowsBasic)+section("服務內容",rowsSvc)+section("其他",rowsOther)+"</body></html>";
  }
  function hook(){
    hideRightPaneExtras();
    var orig=window.openDetails;
    window.openDetails=function(item){
      if(typeof orig==='function'){try{orig(item);}catch(e){console.warn('orig openDetails failed',e);}}
      try{
        if(!window.CURRENT_ITEM) window.CURRENT_ITEM=item||null;
        ensureEmailIframe();
        var ctx={}; try{ctx=(item&&typeof normalizeContext==='function')?(normalizeContext(item)||{}):((item&&item.context)||{});}catch(e){ctx=(item&&item.context)||{};}
        var iframe=document.getElementById('emailPreview'); if(!iframe) return;
        if(ctx.email_html_url){iframe.removeAttribute('srcdoc'); iframe.src=ctx.email_html_url; return;}
        if(ctx.email_html){renderEmailToRightPane(ctx.email_html); return;}
        var raw=(item&&item.context&&(item.context.raw||item.context.email_text))?(item.context.raw||item.context.email_text):"";
        if(raw){renderEmailToRightPane(raw); return;}
        iframe.removeAttribute('src'); iframe.srcdoc=buildFromCtx(ctx||{});
      }catch(e){console.warn('addon openDetails failed',e);}
    };
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',hook);}else{hook();}
})();

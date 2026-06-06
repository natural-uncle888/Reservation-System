
(function(){
  const _origFetch = window.fetch;
  window.fetch = function(input, init){
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/\/\.netlify\/functions\/delete-booking/.test(url)) {
        init = init || {};
        init.headers = Object.assign({}, init.headers || {});
        // ensure token
        if (!window.ADMIN_TOKEN) {
          try { window.ADMIN_TOKEN = localStorage.getItem('admin_token') || ''; } catch(e){}
        }
        if (!init.headers['x-admin-token']) {
          init.headers['x-admin-token'] = window.ADMIN_TOKEN || '';
        }
        if (!init.headers['x-admin-token']) {
          console.warn('[delete-booking] missing x-admin-token, request may 401');
        }
      }
    } catch(e) {}
    return _origFetch.apply(this, arguments);
  };
})();

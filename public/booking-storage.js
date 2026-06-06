(function(){
  var KEY = 'BOOKING_DATA';
  var TTL_MS = 24 * 60 * 60 * 1000;

  function now(){ return Date.now(); }
  function expiresAt(){ return now() + TTL_MS; }
  function parse(raw){
    if(!raw) return {};
    try { return JSON.parse(raw) || {}; }
    catch(e){ return {}; }
  }
  function stripMeta(data){
    var out = Object.assign({}, data || {});
    delete out.expiresAt;
    delete out._savedAt;
    return out;
  }
  function isExpired(data){
    return !!(data && data.expiresAt && Number(data.expiresAt) <= now());
  }
  function readRaw(){ return parse(localStorage.getItem(KEY)); }
  function write(data){
    var next = Object.assign({}, data || {}, { _savedAt: now(), expiresAt: expiresAt() });
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  window.BOOKING_STORAGE = {
    KEY: KEY,
    TTL_MS: TTL_MS,
    getRaw: function(){
      var data = readRaw();
      if(isExpired(data)){
        localStorage.removeItem(KEY);
        return {};
      }
      return data;
    },
    get: function(){
      return stripMeta(this.getRaw());
    },
    save: function(part){
      var prev = this.get();
      return write(Object.assign(prev, part || {}));
    },
    replace: function(data){
      return write(data || {});
    },
    set: function(data){
      return write(data || {});
    },
    touch: function(){
      var current = this.get();
      if(Object.keys(current).length) return write(current);
      return {};
    },
    clear: function(){
      localStorage.removeItem(KEY);
    },
    isExpired: function(){
      return isExpired(readRaw());
    },
    getRemainingMs: function(){
      var data = this.getRaw();
      return data.expiresAt ? Math.max(0, Number(data.expiresAt) - now()) : null;
    }
  };
})();

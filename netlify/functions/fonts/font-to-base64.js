// font-to-base64.js
// 用法：node font-to-base64.js <字型檔路徑>
// 範例：node font-to-base64.js NotoSansTC-Regular.otf
const fs = require('fs');
const path = require('path');

(async function(){
  try {
    const file = process.argv[2];
    if (!file) {
      console.error('請提供字型檔路徑，例如：node font-to-base64.js NotoSansTC-Regular.otf');
      process.exit(1);
    }
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) {
      console.error('找不到檔案：', p);
      process.exit(1);
    }
    const b64 = fs.readFileSync(p).toString('base64');
    console.log(b64);
  } catch (e) {
    console.error(e && e.message || e);
    process.exit(1);
  }
})();
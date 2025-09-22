部署（Netlify + Brevo API）
1) 將本資料夾加入你的 GitHub 專案（根目錄），保留原本的 public/。
2) Netlify 連結該 repo，Build Publish directory 設為 public。
3) 在 Netlify 設定環境變數：
   - BREVO_API_KEY = <你的 Brevo API Key>
   - EMAIL_FROM = natural.uncle@gmail.com
   - EMAIL_TO   = natural.uncle@gmail.com
   - EMAIL_SUBJECT_PREFIX = 自然大叔報價
   - CLOUDINARY_CLOUD_NAME = dvz4druzc
4) 前端照舊呼叫 /submit，會被 netlify.toml 轉到函式。

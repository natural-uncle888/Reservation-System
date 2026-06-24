部署（Netlify + Brevo API）
1) 將本資料夾加入你的 GitHub 專案（根目錄），保留原本的 public/。
2) Netlify 連結該 repo，Build Publish directory 設為 public。
3) 在 Netlify 設定環境變數：
   - BREVO_API_KEY = <你的 Brevo API Key>
   - EMAIL_FROM = natural.uncle@gmail.com
   - EMAIL_TO   = natural.uncle@gmail.com
   - EMAIL_SUBJECT_PREFIX = 自然大叔報價
   - CLOUDINARY_CLOUD_NAME = dvz4druzc
   - CLOUDINARY_API_KEY = <你的 Cloudinary API Key>
   - CLOUDINARY_API_SECRET = <你的 Cloudinary API Secret>
   - ADMIN_JWT_SECRET = <後台登入 token secret>
4) 前端照舊呼叫 /submit，會被 netlify.toml 轉到函式。

後台通知設定
1) 後台管理頁新增「通知設定」分頁。
2) 可手動開啟 / 關閉：
   - Brevo Email 通知總開關
   - LINE 推播通知總開關
   - 新預約通知：Email
   - 新預約通知：LINE
   - 價格設定變更通知：Email
   - 案件刪除通知：Email
   - LINE 夜間靜音模式（預設時間 22:00～08:00，台灣時間 Asia/Taipei）
3) 夜間靜音只會暫停 LINE 推播，Email 仍會正常寄出。
4) 設定會儲存在 Cloudinary raw JSON，預設 public_id：settings/notification-config.json。
5) 若要自訂儲存位置，可在 Netlify 環境變數加入：
   - CLOUDINARY_NOTIFICATION_PUBLIC_ID = settings/notification-config.json
6) 若尚未儲存任何通知設定，系統預設 Email 與 LINE 都是開啟，夜間靜音預設關閉，維持原本通知行為。

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

後台價格設定
1) 後台管理頁的「價格設定」分頁可直接修改各服務價格，無需修改 HTML / JavaScript。
2) 價格會儲存在 Cloudinary raw JSON，預設 public_id：settings/pricing-config.json。
3) 前台 pricing.js 會透過 /.netlify/functions/get-pricing 讀取最新價格；讀取失敗時使用程式內建預設值。
4) 服務頁上的價目文字已改為與即時估價共用同一份價格來源，避免後台漲價後頁面仍顯示舊價格。
5) 儲存前會顯示「舊價格 → 新價格」異動預覽，並對優惠價高於一般價等情況提出警告。
6) 每次實際調價可填寫變更備註，系統會在 pricing JSON 中保留最近 30 次異動紀錄（時間、帳號、備註、異動項目）。
7) 特殊機型加價區間新增 acSpecialExtraMin，預設 300；acTransformer 預設 500，兩者共同控制前台特殊機型加價區間文字。
8) 若要自訂價格設定儲存位置，可在 Netlify 環境變數加入：
   - CLOUDINARY_PRICING_PUBLIC_ID = settings/pricing-config.json

## 本次修改：後台分頁資訊完整化
- 後台分頁中央顯示「第 X / Y 頁」。
- 列表下方顯示「顯示第 A–B 筆｜共 N 筆訂單」。
- list-bookings API 新增 total_count、total_pages、page、has_next。
- 關鍵字／狀態篩選改用頁碼掃描，避免 Cloudinary 游標在本地過濾時漏掉訂單。

- `public/index.html`：目前啟用 B 版首頁（常用服務優先）。
- 「其他居家清洗」中的服務文案已明確標示為「直立式洗衣機・水塔・自來水管」。

## 目前首頁版本

- `public/index.html`：B 版正式優化首頁。
- 主要入口：冷氣清洗、其他居家清洗（直立式洗衣機・水塔・自來水管）。
- 團購與公司／大量清洗為第二層入口。


## 正式網址（2026-10-07）

- 線上預約正式網址：`https://booking.naturaluncle.com/`
- 公司官方網站：`https://naturaluncle.com/`
- 對外分享請優先使用正式網域，避免再使用 `*.netlify.app` 網址。

# 自然大叔 線上預約部署指引

## 部署步驟
1. 將此資料夾推到 GitHub。
2. 在 Netlify 連接該 repo。
3. 設定環境變數：BREVO_API_KEY、MAIL_TO、MAIL_FROM、CLOUDINARY_CLOUD_NAME、CLOUDINARY_API_KEY、CLOUDINARY_API_SECRET。
4. 部署後測試 `final-booking.html` 提交流程。

## 成功導向
- `final-booking.html` 送出後預設導向 `thank-you.html`。
- 如需改回首頁，將 `<body data-success-redirect="thank-you.html">` 改成 `index.html`。

## 信件與備份
- Netlify Function `submit.js` 會寄信到 `MAIL_TO`，並將完整 JSON 備份到 Cloudinary `uncle-bookings/`（resource_type: raw）。

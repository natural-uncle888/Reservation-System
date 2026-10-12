# 自然大叔｜線上預約｜舊 Netlify 網址 301 永久轉址

日期：2026-10-13

本次只新增舊 Netlify 網址至正式網域的 301 永久轉址：

- `https://uncle-reservation-platform.netlify.app/*`
- → `https://booking.naturaluncle.com/:splat`

會保留原路徑，例如：

- `https://uncle-reservation-platform.netlify.app/privacy.html`
- → `https://booking.naturaluncle.com/privacy.html`

原有 `/submit` → Netlify Function 的 200 rewrite 保留，不影響正式網域預約送出功能。

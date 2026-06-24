// netlify/functions/notification-utils.js
// Shared helpers for 後台管理 > 通知設定.
// Settings are stored as a Cloudinary raw JSON asset.

const crypto = require('crypto');

const DEFAULT_NOTIFICATION_SETTINGS = {
  // 通知管道總開關
  brevoEmailEnabled: true,
  linePushEnabled: true,

  // 通知事件開關
  newBookingEmailEnabled: true,
  newBookingLineEnabled: true,
  pricingChangeEmailEnabled: true,
  bookingDeleteEmailEnabled: true,

  // 夜間靜音：只影響 LINE 推播，Email 仍會寄送
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  quietHoursTimezone: 'Asia/Taipei'
};

const NOTIFICATION_PUBLIC_ID = process.env.CLOUDINARY_NOTIFICATION_PUBLIC_ID || 'settings/notification-config.json';

function nb(v) { return v == null ? '' : String(v).trim(); }
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function pickBoolean(src, paths, fallback) {
  for (const path of paths) {
    const parts = path.split('.');
    let cur = src;
    for (const p of parts) cur = cur && typeof cur === 'object' ? cur[p] : undefined;
    if (typeof cur === 'boolean') return cur;
  }
  return fallback;
}
function isValidHHMM(v) {
  if (!/^\d{2}:\d{2}$/.test(String(v || ''))) return false;
  const [h, m] = String(v).split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
function normalizeTime(v, fallback) {
  return isValidHHMM(v) ? String(v) : fallback;
}
function normalizeTimezone(v) {
  const tz = nb(v) || DEFAULT_NOTIFICATION_SETTINGS.quietHoursTimezone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch (_) {
    return DEFAULT_NOTIFICATION_SETTINGS.quietHoursTimezone;
  }
}
function normalizeNotificationSettings(input) {
  const src = input && typeof input === 'object' ? (input.notifications || input.settings || input) : {};
  const quietHours = src.quietHours && typeof src.quietHours === 'object' ? src.quietHours : {};

  return {
    brevoEmailEnabled: pickBoolean(src, ['brevoEmailEnabled', 'channels.email'], DEFAULT_NOTIFICATION_SETTINGS.brevoEmailEnabled),
    linePushEnabled: pickBoolean(src, ['linePushEnabled', 'channels.line'], DEFAULT_NOTIFICATION_SETTINGS.linePushEnabled),

    newBookingEmailEnabled: pickBoolean(src, ['newBookingEmailEnabled', 'newBookingEmail', 'events.newBooking.email'], DEFAULT_NOTIFICATION_SETTINGS.newBookingEmailEnabled),
    newBookingLineEnabled: pickBoolean(src, ['newBookingLineEnabled', 'newBookingLine', 'events.newBooking.line'], DEFAULT_NOTIFICATION_SETTINGS.newBookingLineEnabled),
    pricingChangeEmailEnabled: pickBoolean(src, ['pricingChangeEmailEnabled', 'pricingChangedEmailEnabled', 'events.pricingChanged.email', 'events.pricingChange.email'], DEFAULT_NOTIFICATION_SETTINGS.pricingChangeEmailEnabled),
    bookingDeleteEmailEnabled: pickBoolean(src, ['bookingDeleteEmailEnabled', 'bookingDeletedEmailEnabled', 'events.bookingDeleted.email', 'events.bookingDelete.email'], DEFAULT_NOTIFICATION_SETTINGS.bookingDeleteEmailEnabled),

    quietHoursEnabled: pickBoolean(src, ['quietHoursEnabled', 'quietHours.enabled'], DEFAULT_NOTIFICATION_SETTINGS.quietHoursEnabled),
    quietHoursStart: normalizeTime(src.quietHoursStart || quietHours.start, DEFAULT_NOTIFICATION_SETTINGS.quietHoursStart),
    quietHoursEnd: normalizeTime(src.quietHoursEnd || quietHours.end, DEFAULT_NOTIFICATION_SETTINGS.quietHoursEnd),
    quietHoursTimezone: normalizeTimezone(src.quietHoursTimezone || quietHours.timezone)
  };
}
function cloudinaryBasicAuthHeader(apiKey, apiSecret) {
  return 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
}
async function findNotificationAsset() {
  const cloud = nb(process.env.CLOUDINARY_CLOUD_NAME);
  const apiKey = nb(process.env.CLOUDINARY_API_KEY);
  const apiSecret = nb(process.env.CLOUDINARY_API_SECRET);
  if (!cloud || !apiKey || !apiSecret) return null;

  const resp = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: cloudinaryBasicAuthHeader(apiKey, apiSecret)
    },
    body: JSON.stringify({
      expression: `resource_type:raw AND public_id="${NOTIFICATION_PUBLIC_ID}"`,
      max_results: 1
    })
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({}));
  return data && data.resources && data.resources[0] ? data.resources[0] : null;
}
async function loadNotificationSettings() {
  try {
    const asset = await findNotificationAsset();
    if (!asset || !asset.secure_url) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    const url = asset.secure_url + (asset.secure_url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!resp.ok) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    const doc = await resp.json().catch(() => ({}));
    return normalizeNotificationSettings(doc.notifications || doc.settings || doc);
  } catch (err) {
    console.warn('Notification settings fallback to default:', err && err.message ? err.message : err);
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h * 60) + m;
}
function currentMinutesInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date || new Date());
  let h = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value || 0);
  if (h === 24) h = 0;
  return h * 60 + m;
}
function isQuietHoursActive(settings, date = new Date()) {
  const s = normalizeNotificationSettings(settings);
  if (!s.quietHoursEnabled) return false;
  const start = toMinutes(s.quietHoursStart);
  const end = toMinutes(s.quietHoursEnd);
  const now = currentMinutesInTimezone(date, s.quietHoursTimezone);
  if (start === end) return true;
  return start < end ? (now >= start && now < end) : (now >= start || now < end);
}
function canSendBrevoEmail(settings, eventField) {
  const s = normalizeNotificationSettings(settings);
  if (!s.brevoEmailEnabled) return { ok: false, reason: 'Brevo Email 通知已於後台關閉' };
  if (eventField && !s[eventField]) return { ok: false, reason: '此 Email 通知事件已於後台關閉' };
  return { ok: true, reason: '' };
}
function canSendLinePush(settings, eventField) {
  const s = normalizeNotificationSettings(settings);
  if (!s.linePushEnabled) return { ok: false, reason: 'LINE 推播通知已於後台關閉' };
  if (eventField && !s[eventField]) return { ok: false, reason: '此 LINE 通知事件已於後台關閉' };
  if (isQuietHoursActive(s)) return { ok: false, reason: `LINE 夜間靜音模式啟用中（${s.quietHoursStart}～${s.quietHoursEnd}，${s.quietHoursTimezone}）` };
  return { ok: true, reason: '' };
}
async function sendBrevoNotification({ subject, html, tags }) {
  const toList = String(process.env.EMAIL_TO || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(email => ({ email }));
  const senderEmail = nb(process.env.EMAIL_FROM);
  const senderId = nb(process.env.BREVO_SENDER_ID);
  const brevoApiKey = nb(process.env.BREVO_API_KEY);

  if (!brevoApiKey) return { status: 'skipped', error: 'BREVO_API_KEY 未設定' };
  if (!toList.length) return { status: 'skipped', error: 'EMAIL_TO 未設定' };
  if (!senderEmail && !senderId) return { status: 'skipped', error: 'EMAIL_FROM 或 BREVO_SENDER_ID 未設定' };

  const sender = senderEmail ? { email: senderEmail } : { id: Number(senderId) };
  const mailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoApiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ sender, to: toList, subject, htmlContent: html, tags: tags || ['reservation-admin'] })
  });
  if (!mailRes.ok) return { status: 'failed', error: `Brevo ${mailRes.status}: ${await mailRes.text()}` };
  return { status: 'sent', error: '' };
}
function buildSimpleAdminEmail(title, rows) {
  const tr = (label, value) => `<tr><th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;white-space:nowrap;">${escapeHtml(label)}</th><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(value || '-')}</td></tr>`;
  return `<!doctype html><html><body style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.6;color:#111827;">
    <h2 style="margin:0 0 12px;">${escapeHtml(title)}</h2>
    <table style="border-collapse:collapse;border:1px solid #e5e7eb;min-width:360px;">${(rows || []).map(r => tr(r[0], r[1])).join('')}</table>
  </body></html>`;
}

module.exports = {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_PUBLIC_ID,
  normalizeNotificationSettings,
  findNotificationAsset,
  loadNotificationSettings,
  isQuietHoursActive,
  canSendBrevoEmail,
  canSendLinePush,
  sendBrevoNotification,
  buildSimpleAdminEmail,
  escapeHtml
};

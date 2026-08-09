// Shared sanitizer for dynamic-service front-end descriptions.
// Only a small, presentation-focused subset of HTML/CSS is allowed.
const cheerio = require('cheerio');

const ALLOWED_TAGS = new Set(['p','div','br','strong','b','em','i','u','span','ul','ol','li']);
const ALLOWED_FONT_SIZES = new Set(['13px','16px','18px','20px']);

function escapeHtml(text){
  return String(text == null ? '' : text)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function plainTextToHtml(text){
  const clean = String(text == null ? '' : text).replace(/\r\n?/g,'\n').slice(0, 1500);
  return escapeHtml(clean).replace(/\n/g,'<br>');
}

function normalizeSafeColor(value){
  const raw = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return '#' + raw.slice(1).split('').map(ch => ch + ch).join('');
  }

  // Browsers frequently serialize a color chosen from <input type="color"> as
  // rgb(...) even when the editor originally used a hex value. Accept only strict
  // numeric rgb/rgba syntax and normalize it back to #rrggbb before storing.
  const commaRgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1(?:\.0+)?|0?\.\d+))?\s*\)$/i);
  const spaceRgb = raw.match(/^rgba?\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s*\/\s*(1(?:\.0+)?|0?\.\d+))?\s*\)$/i);
  const match = commaRgb || spaceRgb;
  if (!match) return '';
  const channels = [match[1], match[2], match[3]].map(Number);
  if (channels.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return '';
  const alpha = match[4] == null ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha !== 1) return '';
  return '#' + channels.map(n => n.toString(16).padStart(2, '0')).join('');
}

function cleanStyle(styleText){
  const safe = [];
  String(styleText || '').split(';').forEach(part => {
    const idx = part.indexOf(':');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().toLowerCase();
    if (key === 'color') {
      const color = normalizeSafeColor(value);
      if (color) safe.push(`color:${color}`);
    }
    if (key === 'font-size' && ALLOWED_FONT_SIZES.has(value)) safe.push(`font-size:${value}`);
  });
  return safe.join(';');
}

function sanitizeDescriptionHtml(input){
  const raw = String(input == null ? '' : input).slice(0, 12000);
  const $ = cheerio.load(`<div id="__rich_root__">${raw}</div>`, null, false);
  const root = $('#__rich_root__');

  // Remove elements whose contents should never survive.
  root.find('script,style,iframe,object,embed,svg,math,form,input,button,textarea,select,link,meta,base').remove();

  // Normalize legacy execCommand <font> output into safe spans.
  root.find('font').each((_, el) => {
    const node = $(el);
    const styles = [];
    const color = normalizeSafeColor(node.attr('color'));
    if (color) styles.push(`color:${color}`);
    const sizeMap = { '1':'13px', '3':'16px', '4':'18px', '5':'20px', '7':'20px' };
    const size = sizeMap[String(node.attr('size') || '')];
    if (size) styles.push(`font-size:${size}`);
    const span = $('<span></span>');
    if (styles.length) span.attr('style', styles.join(';'));
    span.append(node.contents());
    node.replaceWith(span);
  });

  // Unwrap unknown tags, preserving only their text/allowed children.
  root.find('*').each((_, el) => {
    const tag = String(el.tagName || '').toLowerCase();
    if (!tag || tag === 'div' && $(el).attr('id') === '__rich_root__') return;
    if (!ALLOWED_TAGS.has(tag)) {
      $(el).replaceWith($(el).contents());
      return;
    }
    const node = $(el);
    const cleanedStyle = cleanStyle(node.attr('style'));
    Object.keys(el.attribs || {}).forEach(attr => node.removeAttr(attr));
    if (cleanedStyle && ['span','p','div'].includes(tag)) node.attr('style', cleanedStyle);
  });

  const safeHtml = root.html() || '';

  // Build a plain-text fallback for old consumers and order snapshots.
  const $p = cheerio.load(`<div id="__plain_root__">${safeHtml}</div>`, null, false);
  const plainRoot = $p('#__plain_root__');
  plainRoot.find('br').replaceWith('\n');
  plainRoot.find('li').each((_, el) => { $p(el).prepend('• '); $p(el).append('\n'); });
  plainRoot.find('p,div').each((_, el) => $p(el).append('\n'));
  const text = plainRoot.text().replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,1500);

  return { html: safeHtml.trim(), text };
}

module.exports = { sanitizeDescriptionHtml, plainTextToHtml, normalizeSafeColor };

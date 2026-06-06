// netlify/functions/get-pricing.js
// Public endpoint used by the front-end estimate module and admin price settings page.
// Reads pricing JSON from Cloudinary raw asset; falls back to DEFAULT_PRICES if not found.

const DEFAULT_PRICES = {
  acSplit: 1800,
  acSplitBulk: 1500,
  acCeiling: 2800,
  acTransformer: 500,
  antiMold: 300,
  antiMoldBulk: 250,
  ozone: 200,
  washer: 2000,
  washerWithAc: 1800,
  tank: 1000,
  tankWithPipe: 800,
  pipeBaseNoKitchenOneBath: 3200,
  pipeBaseOneKitchenOneBath: 4200,
  pipeExtraBathOrKitchen: 500
};

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const PRICING_PUBLIC_ID = process.env.CLOUDINARY_PRICING_PUBLIC_ID || 'settings/pricing-config.json';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    },
    body: JSON.stringify(body)
  };
}

function normalizePrices(input) {
  const out = { ...DEFAULT_PRICES };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULT_PRICES)) {
    const n = Number(input[key]);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return out;
}

function basicAuthHeader(key, secret) {
  const token = Buffer.from(`${key}:${secret}`).toString('base64');
  return `Basic ${token}`;
}

async function findPricingAsset() {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) return null;
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/search`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(API_KEY, API_SECRET)
    },
    body: JSON.stringify({
      expression: `resource_type:raw AND public_id="${PRICING_PUBLIC_ID}"`,
      max_results: 1
    })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data && data.resources && data.resources[0] ? data.resources[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }
  try {
    const asset = await findPricingAsset();
    if (!asset || !asset.secure_url) {
      return json(200, { prices: DEFAULT_PRICES, source: 'default' });
    }
    const url = asset.secure_url + (asset.secure_url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!resp.ok) return json(200, { prices: DEFAULT_PRICES, source: 'default', warning: 'pricing asset fetch failed' });
    const doc = await resp.json();
    const prices = normalizePrices(doc.prices || doc);
    return json(200, { prices, source: 'cloudinary', updated_at: doc.updated_at || asset.updated_at || asset.created_at || null });
  } catch (err) {
    return json(200, { prices: DEFAULT_PRICES, source: 'default', warning: err && err.message ? err.message : String(err) });
  }
};

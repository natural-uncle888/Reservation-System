// netlify/functions/auth-login.js
// 簡易登入（帳號密碼）+ 3 次錯誤即鎖定 30 分鐘（以簽名 Cookie 記錄嘗試次數）
// 需要環境變數：ADMIN_USER, ADMIN_PASS, ADMIN_JWT_SECRET
//
// - 成功登入：回傳 token（12 小時），並清除嘗試次數 Cookie
// - 失敗登入：遞增錯誤次數；達 3 次後回傳 423 Locked，鎖定 30 分鐘
// - Cookie 名稱：admin_try（HttpOnly + Secure + Lax，簽名避免竄改）

const crypto = require("crypto");

const LOCK_TRIES = 3;
const LOCK_MINUTES = 30;

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64urlDecode(str){
  const s = String(str).replace(/-/g,"+").replace(/_/g,"/");
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s + pad, "base64").toString("utf8");
}
function signRaw(data, secret){
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}
function signPayload(payload, secret){
  const data = b64url(JSON.stringify(payload));
  const sig = signRaw(data, secret);
  return `${data}.${sig}`;
}
function verifyToken(token, secret){
  if(!token || !secret) return null;
  const [data, sig] = String(token).split(".");
  if(!data || !sig) return null;
  const expect = signRaw(data, secret);
  if(expect !== sig) return null;
  try { return JSON.parse(b64urlDecode(data)); } catch { return null; }
}
function readCookie(cookieHeader, name){
  if(!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  for(const p of parts){
    const [k, v] = p.split("=");
    if(k === name) return decodeURIComponent(v || "");
  }
  return null;
}
function cookieSet(name, value, { maxAgeSec }){
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (typeof maxAgeSec === "number") attrs.push(`Max-Age=${maxAgeSec}`);
  return attrs.join("; ");
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    const { ADMIN_USER, ADMIN_PASS, ADMIN_JWT_SECRET } = process.env;
    if (!ADMIN_USER || !ADMIN_PASS || !ADMIN_JWT_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Admin auth env not configured" }), headers: { "Content-Type":"application/json" } };
    }

    // 讀取嘗試次數（簽名 Cookie）
    const cookieHeader = event.headers.cookie || event.headers.Cookie || "";
    const tryCookie = readCookie(cookieHeader, "admin_try");
    let tries = 0;
    let until = 0;
    if (tryCookie) {
      const val = verifyToken(tryCookie, ADMIN_JWT_SECRET);
      if (val && typeof val.cnt === "number") { tries = val.cnt|0; }
      if (val && typeof val.until === "number") { until = val.until|0; }
    }

    const now = Math.floor(Date.now()/1000);
    // 若已被鎖定且未到期，直接拒絕
    if (until > now) {
      const mins = Math.ceil((until - now)/60);
      return {
        statusCode: 423, // Locked
        body: JSON.stringify({ error: "Locked", message: `登入已鎖定，請 ${mins} 分鐘後再試` }),
        headers: {
          "Content-Type":"application/json",
          // 保持現有 cookie（縮短剩餘時間）
          "Set-Cookie": cookieSet("admin_try", signPayload({ cnt: tries, until }, ADMIN_JWT_SECRET), { maxAgeSec: Math.max(until - now, 0) })
        }
      };
    }

    // 解析輸入
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch(e){
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }), headers: { "Content-Type":"application/json" } };
    }
    const { username, password } = body;

    // 驗證帳密
    const ok = (username === ADMIN_USER && password === ADMIN_PASS);
    if (!ok) {
      tries = (tries || 0) + 1;
      if (tries >= LOCK_TRIES) {
        until = now + LOCK_MINUTES * 60;
        tries = LOCK_TRIES;
      }
      const token = signPayload({ cnt: tries, until }, ADMIN_JWT_SECRET);
      const maxAge = until > now ? (until - now) : (15 * 60); // 未鎖定時保存 15 分鐘以便統計
      return {
        statusCode: until > now ? 423 : 401,
        body: JSON.stringify({
          error: until > now ? "Locked" : "Invalid credentials",
          message: until > now ? `登入已鎖定，請 ${Math.ceil((until-now)/60)} 分鐘後再試` : `帳號或密碼錯誤（已嘗試 ${tries}/${LOCK_TRIES} 次）`
        }),
        headers: {
          "Content-Type":"application/json",
          "Set-Cookie": cookieSet("admin_try", token, { maxAgeSec: maxAge })
        }
      };
    }

    // 成功登入：簽發存取 token，並清除嘗試次數 cookie
    const exp = Math.floor(Date.now()/1000) + 60 * 60 * 12; // 12h
    const accessToken = signPayload({ u: username, exp }, ADMIN_JWT_SECRET);

    return {
      statusCode: 200,
      body: JSON.stringify({ token: accessToken, exp }),
      headers: {
        "Content-Type":"application/json",
        // 清除 admin_try
        "Set-Cookie": cookieSet("admin_try", "", { maxAgeSec: 0 })
      }
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e && e.message ? e.message : String(e) }), headers: { "Content-Type":"application/json" } };
  }
};

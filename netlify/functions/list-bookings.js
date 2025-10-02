// netlify/functions/list-bookings.js
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 將 context / metadata 常見鍵映射成統一欄位（避免前端要猜鍵名）
function normalize(x) {
  const c = x && x.context ? (x.context.custom || x.context) : {};
  const m = x && x.metadata ? x.metadata : {};
  function pick(keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (c && c[k] != null && String(c[k]).trim() !== "") return String(c[k]).trim();
      if (m && m[k] != null && String(m[k]).trim() !== "") return String(m[k]).trim();
    }
    return "";
  }
  return {
    name:        pick(["name","姓名","customer_name","fullname"]),
    phone:       pick(["phone","電話","phone_number","mobile","tel"]),
    service:     pick(["service","服務","service_category","service_item","select_service"]),
    address:     pick(["address","地址"]),
    brand:       pick(["brand","冷氣品牌"]),
    ac_type:     pick(["ac_type","冷氣類型"]),
    count:       pick(["count","清洗數量","quantity"]),
    floor:       pick(["floor","樓層","室內機所在樓層"]),
    is_inverter: pick(["is_inverter","變頻","是否為變頻機型系列","是否為變形金剛系列"]),
    antifungus:  pick(["antifungus","防霉抗菌處理","冷氣防霉抗菌處理"]),
    ozone:       pick(["ozone","臭氧消毒","臭氧殺菌消毒","臭氧空間消毒"]),
    extra_service: pick(["extra_service","其他清洗服務"]),
    line:        pick(["line_id","line","LINE","聯絡Line","LINE 或 Facebook 名稱"]),
    fb:          pick(["fb_name","facebook","FB"]),
    date:        pick(["date","預約日期"]),
    timeslot:    pick(["timeslot","預約時段","時段","可安排時段"]),
    contact_time:pick(["contact_time","方便聯繫時間"]),
    note:        pick(["note","備註","其他備註"]),
    pdf:         pick(["pdf","pdf_url","PDF連結","PDF"])
  };
}

exports.handler = async function (event) {
  try {
    var headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    };

    var body = {};
    try { if (event.body) body = JSON.parse(event.body); } catch (e) {}

    var q = (body.q || "").trim();
    var start = body.start || "";
    var end = body.end || "";
    var max = Math.min(Number(body.max) || 50, 200);
    var nextCursor = body.next_cursor || null;

    // 組 Cloudinary 查詢；若你的資料不是 raw，改成對應的 resource_type 或移除這行
    var exprParts = [];
    exprParts.push("resource_type=raw");
    if (q) exprParts.push("(public_id:" + q + "* OR filename:" + q + "* OR context=*" + q + "* OR metadata=*" + q + "*)");
    if (start) exprParts.push("created_at>=" + new Date(start).toISOString());
    if (end)   exprParts.push("created_at<=" + new Date(end).toISOString());
    var expr = exprParts.join(" AND ");

    var search = cloudinary.search
      .expression(expr)
      .sort_by("created_at", "desc")
      .with_field("context")
      .with_field("metadata")
      .max_results(max);

    if (nextCursor) search = search.next_cursor(nextCursor);

    var data = await search.execute();

    var items = (data.resources || []).map(function (x) {
      return {
        public_id: x.public_id,
        created_at: x.created_at,
        bytes: x.bytes,
        resource_type: x.resource_type,
        type: x.type,
        format: x.format,
        url: x.url || x.secure_url,
        secure_url: x.secure_url || x.url,
        context: x.context || null,
        metadata: x.metadata || null,
        width: x.width,
        height: x.height,
        normalized: normalize(x) // 新增的統一欄位
      };
    });

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        items: items,
        next_cursor: data.next_cursor || null,
        count: items.length
      })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: String((err && err.message) || err) })
    };
  }
};

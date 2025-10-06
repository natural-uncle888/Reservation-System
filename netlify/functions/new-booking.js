const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = async (event) => {
  try {
    const booking = JSON.parse(event.body);

    // 用一個最小的空檔案內容（這裡用 text/plain 也行）
    const fakeFile = "data:text/plain;base64,"; // 空檔案

    // 上傳到 Cloudinary
    const result = await cloudinary.uploader.upload(fakeFile, {
      resource_type: "raw",
      context: { custom: booking }, // 這裡會完整存你傳的所有欄位
      folder: "bookings",
      public_id: booking["預約單編號"] || undefined
    });

    // 回傳 cloudinary 實際 response（你可以直接看到 public_id, url, context.custom）
    return {
      statusCode: 200,
      body: JSON.stringify({ cloudinary: result })
    };
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Upload failed", details: String(e) })
    };
  }
};

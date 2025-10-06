const fs = require("fs");
const path = require("path");
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = async (event) => {
  try {
    const booking = JSON.parse(event.body);

    // 建立一個臨時檔案作為 raw 上傳內容
    const tempFilePath = "/tmp/empty.txt";
    fs.writeFileSync(tempFilePath, "booking-data");

    const result = await cloudinary.uploader.upload(tempFilePath, {
      resource_type: "raw",
      context: { custom: booking },
      folder: "bookings",
      public_id: booking["預約單編號"] || undefined
    });

    // 刪除臨時檔案
    fs.unlinkSync(tempFilePath);

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

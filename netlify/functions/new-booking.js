const fs = require("fs");
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = async (event) => {
  try {
    const booking = JSON.parse(event.body);

    // 準備一張最小的空白png
    const tempFilePath = "/tmp/empty.png";
    fs.writeFileSync(tempFilePath, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64"
    ));

    const result = await cloudinary.uploader.upload(tempFilePath, {
      resource_type: "image",  // image格式支援context 100%穩
      context: { custom: booking },
      folder: "bookings",
      public_id: booking["預約單編號"] || undefined
    });

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

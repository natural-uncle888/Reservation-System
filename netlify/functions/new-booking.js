const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = async (event) => {
  // 1. 取得前端送來的表單資料
  const booking = JSON.parse(event.body);

  // 2. 如果你不需要真的上傳檔案，可以用一個空白檔案（或 text string base64）
  //    這裡直接丟一個空字串給 raw 檔案（或根據你的應用改成圖片/pdf也行）
  const fileToUpload = Buffer.from('', 'utf8'); // 空檔

  // 3. 上傳到 Cloudinary，重點 context.custom
  try {
    const res = await cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        context: { custom: booking }, // <<--- 重點
        folder: "bookings",           // (可選) 你自己的資料夾
        public_id: booking["預約單編號"] || undefined // (可選) 你想自訂的 id
      },
      (error, result) => {
        if (error) {
          console.error(error);
          return {
            statusCode: 500,
            body: JSON.stringify({ error: "Cloudinary upload error" }),
          };
        }
        return {
          statusCode: 200,
          body: JSON.stringify({ cloudinary: result }),
        };
      }
    );

    // 必須寫 stream，這是 Cloudinary raw 檔案的 upload
    require('stream').Readable.from(fileToUpload).pipe(res);

    // 這裡 netlify function 要等 callback 完才真的回應（可簡化處理）
    return {
      statusCode: 200,
      body: JSON.stringify({ msg: "上傳中…" }),
    };
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Upload failed" }),
    };
  }
};

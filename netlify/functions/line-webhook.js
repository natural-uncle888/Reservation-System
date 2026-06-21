exports.handler = async function(event) {
  try {
    const body = JSON.parse(event.body || "{}");

    console.log("LINE webhook body:", JSON.stringify(body, null, 2));

    const events = body.events || [];

    for (const ev of events) {
      console.log("LINE event source:", JSON.stringify(ev.source, null, 2));

      if (ev.source?.userId) {
        console.log("LINE_USER_ID:", ev.source.userId);
      }

      if (ev.source?.groupId) {
        console.log("LINE_GROUP_ID:", ev.source.groupId);
      }

      if (ev.message?.text) {
        console.log("LINE message text:", ev.message.text);
      }
    }

    return {
      statusCode: 200,
      body: "OK"
    };
  } catch (err) {
    console.error("LINE webhook error:", err);

    return {
      statusCode: 200,
      body: "OK"
    };
  }
};

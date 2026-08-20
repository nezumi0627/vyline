import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    accountId: { type: "string", short: "a" },
    chatMid: { type: "string", short: "c" },
    messageId: { type: "string", short: "m" },
    text: { type: "string", short: "t" },
    port: { type: "string", short: "p", default: "3001" },
  },
});

const { accountId, chatMid, messageId, text, port } = values;

if (!accountId || !chatMid) {
  console.error(
    "❌ Usage: bun scripts/getEditedMessageJson.ts -a <accountId> -c <chatMid> [-m <messageId>] [-t <text>]",
  );
  console.error(
    "Example: bun scripts/getEditedMessageJson.ts -a main -c c1efe9d6cf1848350bc91848a8a29963e -m 628117045912798141 -t 'Hello Edited!'",
  );
  process.exit(1);
}

const baseUrl = `http://localhost:${port}/line/${accountId}`;

async function main() {
  try {
    if (messageId && text) {
      console.log(`✏️ Editing message ${messageId} in chat ${chatMid} with text: "${text}"...`);
      const editRes = await fetch(`${baseUrl}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatMid, messageId, text }),
      });
      if (!editRes.ok) {
        console.error(`❌ Edit failed with status ${editRes.status}`);
        const errText = await editRes.text();
        console.error(errText);
        process.exit(1);
      }
      const editData = await editRes.json();
      console.log("🎉 Edit result JSON:\n", JSON.stringify(editData, null, 2));
    }

    console.log(`🔍 Fetching message edit notice for chat ${chatMid}...`);
    const noticeRes = await fetch(`${baseUrl}/edit-notice/${chatMid}`);
    if (!noticeRes.ok) {
      console.error(`❌ Fetching notice failed with status ${noticeRes.status}`);
      const errText = await noticeRes.text();
      console.error(errText);
      process.exit(1);
    }
    const noticeData = await noticeRes.json();
    console.log("🎉 Edit Notice JSON:\n", JSON.stringify(noticeData, null, 2));
  } catch (err) {
    console.error("❌ Error occurred:", err);
  }
}

main();

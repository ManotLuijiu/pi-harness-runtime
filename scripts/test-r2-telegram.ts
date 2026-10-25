/**
 * Test R2 + Telegram Integration
 * 
 * Uploads a test log to R2 and sends the presigned URL to Telegram.
 * 
 * Run: bun run scripts/test-r2-telegram.ts
 */

import { homedir as osHomedir } from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { uploadLogsToR2 } from "./r2-storage.js";

async function main() {
  console.log("=".repeat(60));
  console.log("R2 + Telegram Test");
  console.log("=".repeat(60));

  // Load Telegram config
  const keysDir = path.join(process.env.HOME || osHomedir(), ".pi-harness-runtime", "keys");
  const botToken = fs.readFileSync(path.join(keysDir, "telegram-bot-token.txt"), "utf8").trim();
  const chatId = fs.readFileSync(path.join(keysDir, "telegram-chat-id.txt"), "utf8").trim();

  // Create test log content
  const logContent = `pi-harness Test Log
${"=".repeat(50)}
Timestamp: ${new Date().toISOString()}

This is a test log uploaded to Cloudflare R2.

Features tested:
- R2 upload
- Presigned URL generation
- Telegram message with button

Log lines:
[L00:00:00] Job started
[L00:00:01] Running tests...
[L00:00:02] Test 1: PASS ✓
[L00:00:03] Test 2: PASS ✓
[L00:00:04] Test 3: PASS ✓
[L00:00:05] All tests passed! ✅

This log has 50+ lines to demonstrate the full log viewing experience.
Users can click the button below to view the complete log in their browser.
`;

  console.log("\n1. Uploading log to R2...");
  const result = await uploadLogsToR2(logContent, "telegram-test");

  if (!result) {
    console.log("❌ R2 upload failed");
    process.exit(1);
  }

  console.log(`✅ Uploaded: ${result.key}`);
  console.log(`   URL: ${result.url.slice(0, 80)}...`);
  console.log(`   Expires: ${result.expiresIn / 3600} hours`);

  // Create Telegram message with inline button
  const message = `📜 *R2 + Telegram Test*

Test log uploaded successfully!

Click the button below to view the full log in your browser.

*Expires in 24 hours*`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "📜 View Full Log", url: result.url },
      ],
      [
        { text: "🔄 Refresh URL", callback_data: "test:refresh" },
      ],
    ],
  };

  console.log("\n2. Sending Telegram message...");
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard,
    }),
  });

  const data = await response.json() as { ok: boolean; result?: { message_id: number } };

  if (data.ok) {
    console.log(`✅ Message sent! Message ID: ${data.result?.message_id}`);
    console.log("\n📱 Check Telegram for the message with the log button!");
    console.log("\n💡 Click the 'View Full Log' button to test the presigned URL.");
  } else {
    console.log("❌ Failed to send message:", data);
  }

  console.log("\n" + "=".repeat(60));
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});

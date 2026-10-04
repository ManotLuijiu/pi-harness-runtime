/**
 * Test Telegram Approval Flow
 * 
 * Sends a test message with Yes/No buttons to verify the full flow:
 * 1. Message sent to Telegram with inline keyboard
 * 2. User clicks button
 * 3. Webhook receives callback
 * 4. Callback processor handles approval/rejection
 * 5. Job command written for pi-harness to resume
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Load config
const keysDir = path.join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "keys");

const botToken = fs.readFileSync(path.join(keysDir, "telegram-bot-token.txt"), "utf8").trim();
const chatId = fs.readFileSync(path.join(keysDir, "telegram-chat-id.txt"), "utf8").trim();

async function sendTestApproval() {
  const message = `*Test Approval Request*\n\n` +
    `A job is waiting for your approval:\n\n` +
    `*Job:* Code Review for PR #123\n` +
    `*Status:* Waiting for human review\n\n` +
    `Do you want to approve this job to continue?`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Yes, Approve", callback_data: "approve:job-123" },
        { text: "❌ No, Reject", callback_data: "reject:job-123" }
      ],
      [
        { text: "🔄 Retry Later", callback_data: "retry:job-123" }
      ]
    ]
  };

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard
    })
  });

  const data = await response.json() as { ok: boolean; result?: { message_id: number } };
  
  if (data.ok) {
    console.log(`✅ Test message sent! Message ID: ${data.result?.message_id}`);
    console.log(`\n📱 Check your Telegram for the approval message.`);
    console.log(`\nWhen you click a button, the webhook at:`);
    console.log(`  https://telegram.moo-vpn.online/api/telegram/webhook`);
    console.log(`\nwill receive the callback and process it.`);
  } else {
    console.error(`❌ Failed to send message:`, data);
  }
}

sendTestApproval().catch(console.error);

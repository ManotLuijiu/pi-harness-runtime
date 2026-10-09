#!/usr/bin/env bun
/**
 * Test Telegram notification
 *
 * Reads credentials from ~/.pi-harness-runtime/keys/
 * - telegram-bot-token.txt
 * - telegram-chat-id.txt
 *
 * DO NOT hardcode credentials here.
 * Rotate your bot token at https://t.me/BotFather if leaked.
 */
import { NotificationCenter } from '../packages/notification/dist/notification-center.js';
import type { NotificationContext } from '../packages/notification/dist/types.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = homedir();
const keysDir = join(home, '.pi-harness-runtime', 'keys');

const botTokenPath = join(keysDir, 'telegram-bot-token.txt');
const chatIdPath = join(keysDir, 'telegram-chat-id.txt');

// Check credentials exist
if (!existsSync(botTokenPath)) {
  console.error("ERROR: telegram-bot-token.txt not found");
  console.error(`  Create: echo "{bot-token}" > ${botTokenPath}`);
  process.exit(1);
}

if (!existsSync(chatIdPath)) {
  console.error("ERROR: telegram-chat-id.txt not found");
  console.error(`  Create: echo "{chat-id}" > ${chatIdPath}`);
  process.exit(1);
}

const botToken = readFileSync(botTokenPath, 'utf8').trim();
const chatId = readFileSync(chatIdPath, 'utf8').trim();

if (!botToken || !chatId) {
  console.error("ERROR: Bot token or chat ID is empty");
  process.exit(1);
}

console.log("Sending test Telegram notification...");

const nc = new NotificationCenter({
  channels: [
    {
      id: "telegram",
      type: "telegram",
      enabled: true,
      config: {
        botToken,
        chatId,
        parseMode: "HTML" as const // Use HTML mode instead of MarkdownV2
      }
    }
  ]
});

const context: NotificationContext = {
  jobId: "test-123",
  requirement: "Testing Telegram notification",
  taskTitle: "Test"
};

nc.notify("HumanReviewNeeded", context).then((results) => {
  console.log("Results:", JSON.stringify(results, null, 2));
  process.exit(0);
}).catch((e: unknown) => {
  console.error("Error:", e);
  process.exit(1);
});

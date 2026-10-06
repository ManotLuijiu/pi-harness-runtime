#!/usr/bin/env bun
import { NotificationCenter } from '../packages/notification/dist/notification-center.js';
import type { NotificationContext } from '../packages/notification/dist/types.js';

const nc = new NotificationCenter({
  channels: [
    {
      id: "telegram",
      type: "telegram",
      enabled: true,
      config: {
        botToken: "0000000000:REDACTED-TOKEN",
        chatId: "1234567890",
        parseMode: undefined // Disable markdown to avoid escaping issues
      }
    }
  ]
});

console.log("Sending test Telegram notification...");

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

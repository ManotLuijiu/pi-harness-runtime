#!/usr/bin/env bun
/**
 * Telegram Webhook Server — RFC-0022
 *
 * Standalone server that:
 * 1. Receives webhook updates from Telegram
 * 2. Handles button clicks (approve/reject)
 * 3. Forwards actions to pi-harness via file queue
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=xxx TELEGRAM_WEBHOOK_URL=https://yourdomain.com/webhook bun run scripts/telegram-webhook-server.ts
 */

import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";

// --- Configuration ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "default-secret-change-me";
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
const CALLBACK_QUEUE_FILE = process.env.CALLBACK_QUEUE_FILE || join(process.env.HOME || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");
const PORT = parseInt(process.env.PORT || "3000", 10);

// --- Verify config ---
if (!BOT_TOKEN) {
  console.error("[TelegramWebhook] ERROR: TELEGRAM_BOT_TOKEN not set");
  console.error("[TelegramWebhook] Usage:");
  console.error("[TelegramWebhook]   TELEGRAM_BOT_TOKEN=xxx bun run scripts/telegram-webhook-server.ts");
  process.exit(1);
}

// --- Types ---
interface CallbackQuery {
  id: string;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat_instance: string;
  data: string;
  message?: {
    chat: { id: number };
    message_id: number;
  };
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: CallbackQuery;
}

interface QueuedCallback {
  timestamp: string;
  queryId: string;
  userId: number;
  username?: string;
  data: string;
  action: string;
  targetId: string;
}

// --- Parse callback data ---
function parseCallbackData(data: string): { action: string; targetId: string } {
  const parts = data.split("_");
  return {
    action: parts[0] || "",
    targetId: parts[1] || "",
  };
}

// --- Queue callback to file ---
function queueCallback(callback: QueuedCallback): void {
  const dir = join(CALLBACK_QUEUE_FILE, "..");
  if (!existsSync(dir)) {
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
  appendFileSync(CALLBACK_QUEUE_FILE, JSON.stringify(callback) + "\n");
  console.log(`[TelegramWebhook] Queued: ${callback.action}_${callback.targetId} from ${callback.username || callback.userId}`);
}

// --- HTTP Request Handler ---
function handleRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  // CORS preflight - only allow Telegram bot API
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    // Only allow requests from Telegram's servers
    const allowedOrigins = [
      "https://api.telegram.org",
      "https://web.telegram.org",
    ];
    const corsOrigin = allowedOrigins.includes(origin || "") ? origin : "";
    
    res.writeHead(204, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-telegram-bot-api-secret-token",
    });
    res.end();
    return;
  }

  // Only accept POST
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Verify secret token
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== WEBHOOK_SECRET) {
    console.warn("[TelegramWebhook] Unauthorized webhook attempt");
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  // Collect body
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", async () => {
    try {
      const update: TelegramUpdate = JSON.parse(body);

      // Handle callback query
      if (update.callback_query) {
        const cq = update.callback_query;
        const parsed = parseCallbackData(cq.data);

        console.log(`[TelegramWebhook] Callback: ${cq.data} from ${cq.from.username || cq.from.first_name}`);

        // Queue for pi-harness to process
        const queued: QueuedCallback = {
          timestamp: new Date().toISOString(),
          queryId: cq.id,
          userId: cq.from.id,
          username: cq.from.username,
          data: cq.data,
          action: parsed.action,
          targetId: parsed.targetId,
        };
        queueCallback(queued);

        // Answer callback query (removes loading state)
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: cq.id }),
        });

        // Send confirmation to user
        const confirmText = parsed.action === "approve"
          ? `✅ Approved! Job ${parsed.targetId} will resume.`
          : parsed.action === "reject"
          ? `❌ Rejected. Job ${parsed.targetId} cancelled.`
          : `Received: ${cq.data}`;

        if (cq.message?.chat.id) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: cq.message.chat.id,
              text: confirmText,
            }),
          });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("[TelegramWebhook] Error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  });
}

// --- Setup webhook with Telegram ---
async function setupWebhook(): Promise<void> {
  if (!WEBHOOK_URL) {
    console.log("[TelegramWebhook] TELEGRAM_WEBHOOK_URL not set — skipping webhook setup");
    console.log("[TelegramWebhook] To set webhook manually:");
    console.log(`[TelegramWebhook]   curl -X POST https://api.telegram.org/bot${BOT_TOKEN}/setWebhook -d '{"url":"YOUR_WEBHOOK_URL","secret_token":"${WEBHOOK_SECRET}"}'`);
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      secret_token: WEBHOOK_SECRET,
    }),
  });

  const result = await response.json() as { ok: boolean; description?: string };
  if (result.ok) {
    console.log(`[TelegramWebhook] Webhook set to: ${WEBHOOK_URL}`);
  } else {
    console.error(`[TelegramWebhook] Webhook setup failed: ${result.description}`);
  }
}

// --- Get current webhook info ---
async function getWebhookInfo(): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const result = await response.json() as { ok: boolean; result?: { url?: string; pending_update_count?: number } };
  if (result.ok && result.result) {
    console.log(`[TelegramWebhook] Current webhook: ${result.result.url || "(not set)"}`);
    console.log(`[TelegramWebhook] Pending updates: ${result.result.pending_update_count || 0}`);
  }
}

// --- Start server ---
async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Telegram Webhook Server — RFC-0022");
  console.log("=".repeat(60));
  console.log(`Bot token: ${BOT_TOKEN!.slice(0, 10)}...`);
  console.log(`Webhook secret: ${WEBHOOK_SECRET.slice(0, 8)}...`);
  console.log(`Callback queue: ${CALLBACK_QUEUE_FILE}`);
  console.log(`Port: ${PORT}`);
  console.log("=".repeat(60));

  await setupWebhook();
  await getWebhookInfo();

  const server = createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`[TelegramWebhook] Server running on port ${PORT}`);
    console.log("[TelegramWebhook] Waiting for Telegram callbacks...");
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[TelegramWebhook] Shutting down...");
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);

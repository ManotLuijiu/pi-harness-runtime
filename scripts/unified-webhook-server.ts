#!/usr/bin/env bun
/**
 * Unified Webhook Server — Handles both Telegram and LINE on single domain
 *
 * Routes:
 *   /telegram → Telegram webhook handler
 *   /line     → LINE webhook handler
 *
 * Usage:
 *   bun run scripts/unified-webhook-server.ts
 *
 * Environment variables (or keys/*.txt files):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_USERS
 *   LINE_CHANNEL_SECRET, LINE_ACCESS_TOKEN
 *
 * Webhook URLs to configure:
 *   Telegram: https://webhook.bunchee.online/telegram
 *   LINE:     https://webhook.bunchee.online/line
 */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, IncomingMessage, ServerResponse } from "node:http";

// --- Configuration ---
interface Config {
  telegram?: {
    botToken: string;
    secret: string;
    allowedUsers: Set<number>;
  };
  line?: {
    channelSecret: string;
    accessToken: string;
  };
}

function getConfig(): Config {
  const homedir = process.env.HOME || "/home/user";
  const keysDir = join(homedir, ".pi-harness-runtime", "keys");
  const config: Config = {};

  // Telegram config
  const telegramTokenPath = join(keysDir, "telegram-bot-token.txt");
  const telegramSecretPath = join(keysDir, "telegram-webhook-secret.txt");
  const telegramUsersPath = join(keysDir, "telegram-allowed-users.txt");

  if (existsSync(telegramTokenPath)) {
    const token = process.env.TELEGRAM_BOT_TOKEN || readFileSync(telegramTokenPath, "utf8").trim();
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || (existsSync(telegramSecretPath) ? readFileSync(telegramSecretPath, "utf8").trim() : "");

    const allowedUsers = new Set<number>();
    const envUsers = process.env.TELEGRAM_ALLOWED_USERS;
    if (envUsers) {
      for (const part of envUsers.split(",")) {
        const num = parseInt(part.trim(), 10);
        if (!isNaN(num) && num > 0) allowedUsers.add(num);
      }
    }
    if (existsSync(telegramUsersPath)) {
      const content = readFileSync(telegramUsersPath, "utf8").trim();
      for (const part of content.split(",")) {
        const num = parseInt(part.trim(), 10);
        if (!isNaN(num) && num > 0) allowedUsers.add(num);
      }
    }

    config.telegram = { botToken: token, secret, allowedUsers };
  }

  // LINE config
  const lineSecretPath = join(keysDir, "line-channel-secret.txt");
  const lineTokenPath = join(keysDir, "line-access-token.txt");

  if (existsSync(lineSecretPath) && existsSync(lineTokenPath)) {
    const channelSecret = process.env.LINE_CHANNEL_SECRET || readFileSync(lineSecretPath, "utf8").trim();
    const accessToken = process.env.LINE_ACCESS_TOKEN || readFileSync(lineTokenPath, "utf8").trim();
    config.line = { channelSecret, accessToken };
  }

  return config;
}

// --- Logging ---
const LOG_FILE = "/tmp/unified-webhook.log";
function log(prefix: string, ...args: unknown[]) {
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  const line = `[${new Date().toISOString()}] [${prefix}] ${msg}\n`;
  appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

// --- Crypto utilities ---
async function verifyTelegram(data: string, secret: string, hash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const expected = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
  return expected === hash;
}

async function verifyLINE(body: string, channelSecret: string, xLineSignature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(channelSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Buffer.from(signature).toString("base64");
  return expected === xLineSignature;
}

// --- Callback queue ---
const QUEUE_FILE = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");
function queueCallback(callback: Record<string, unknown>) {
  appendFileSync(QUEUE_FILE, JSON.stringify({ ...callback, timestamp: new Date().toISOString() }) + "\n");
}

// --- Telegram handler ---
async function handleTelegram(req: IncomingMessage, res: ServerResponse, config: Config) {
  if (!config.telegram) {
    res.writeHead(404);
    res.end("Telegram not configured");
    return;
  }

  // Verify secret token
  const secretToken = req.headers["x-telegram-bot-api-secret-token"];
  if (secretToken !== config.telegram.secret) {
    log("Telegram", "Unauthorized - secret mismatch");
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();

  try {
    const update = JSON.parse(body);

    // Handle callback query (button click)
    if (update.callback_query) {
      const query = update.callback_query;
      const from = query.from;

      // Check authorization
      if (config.telegram.allowedUsers.size > 0 && !config.telegram.allowedUsers.has(from.id)) {
        log("Telegram", `Unauthorized user: ${from.id}`);
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      // Parse callback data
      const data = query.data || "";
      const colonIdx = data.indexOf(":");
      const underscoreIdx = data.indexOf("_");
      let action: string, targetId: string;
      if (colonIdx !== -1) {
        action = data.slice(0, colonIdx);
        targetId = data.slice(colonIdx + 1).replace(/_+$/, "");
      } else if (underscoreIdx !== -1) {
        action = data.slice(0, underscoreIdx);
        targetId = data.slice(underscoreIdx + 1).replace(/_+$/, "");
      } else {
        action = data;
        targetId = "";
      }

      // Queue the callback
      queueCallback({
        type: "telegram_callback",
        action,
        targetId,
        userId: from.id,
        username: from.username,
        messageId: query.message?.message_id,
      });

      // Acknowledge immediately
      await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: query.id }),
      });

      log("Telegram", `Callback: ${action} ${targetId} from @${from.username || from.id}`);
    }

    res.writeHead(200);
    res.end("OK");
  } catch (err) {
    log("Telegram", "Error:", err);
    res.writeHead(500);
    res.end("Error");
  }
}

// --- LINE handler ---
async function handleLINE(req: IncomingMessage, res: ServerResponse, config: Config) {
  if (!config.line) {
    res.writeHead(404);
    res.end("LINE not configured");
    return;
  }

  // Verify signature
  const signature = req.headers["x-line-signature"] as string;
  if (!signature) {
    log("LINE", "Missing signature");
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();

  // Verify
  if (!(await verifyLINE(body, config.line.channelSecret, signature))) {
    log("LINE", "Invalid signature");
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const events = JSON.parse(body).events || [];

    for (const event of events) {
      if (event.type === "postback") {
        // Parse postback data
        const data = event.postback?.data || "";
        const colonIdx = data.indexOf(":");
        let action: string, targetId: string;
        if (colonIdx !== -1) {
          action = data.slice(0, colonIdx);
          targetId = data.slice(colonIdx + 1);
        } else {
          action = data;
          targetId = "";
        }

        queueCallback({
          type: "line_callback",
          action,
          targetId,
          userId: event.source?.userId,
          replyToken: event.replyToken,
        });

        log("LINE", `Postback: ${action} ${targetId}`);
      } else if (event.type === "message" && event.message?.type === "text") {
        // Forward text messages to agent
        queueCallback({
          type: "line_message",
          text: event.message.text,
          userId: event.source?.userId,
          replyToken: event.replyToken,
        });

        log("LINE", `Message: ${event.message.text}`);
      }
    }

    res.writeHead(200);
    res.end("OK");
  } catch (err) {
    log("LINE", "Error:", err);
    res.writeHead(500);
    res.end("Error");
  }
}

// --- Main server ---
const PORT = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const config = getConfig();

  if (!config.telegram && !config.line) {
    console.error("No webhooks configured. Set up Telegram and/or LINE keys.");
    process.exit(1);
  }

  console.log("Unified Webhook Server");
  console.log(`Listening on port ${PORT}`);
  if (config.telegram) console.log("  /telegram - Telegram webhook");
  if (config.line) console.log("  /line     - LINE webhook");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    try {
      if (url.pathname === "/telegram" && req.method === "POST") {
        await handleTelegram(req, res, config);
      } else if (url.pathname === "/line" && req.method === "POST") {
        await handleLINE(req, res, config);
      } else if (url.pathname === "/health") {
        res.writeHead(200);
        res.end("OK");
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    } catch (err) {
      log("Server", "Error:", err);
      res.writeHead(500);
      res.end("Error");
    }
  });

  server.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Configure webhooks:`);
    if (config.telegram) {
      console.log(`  Telegram: https://webhook.bunchee.online/telegram`);
    }
    if (config.line) {
      console.log(`  LINE:     https://webhook.bunchee.online/line`);
    }
  });
}

main();

#!/usr/bin/env bun
/**
 * Unified Webhook Server — Handles Telegram, LINE, and WebSocket relay
 *
 * Routes:
 *   /telegram → Telegram webhook handler
 *   /line     → LINE webhook handler
 *   /ws       → WebSocket relay (port 8444)
 *
 * Usage:
 *   bun run scripts/unified-webhook-server.ts
 */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "os";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

// --- Configuration ---
interface Config {
  telegram?: {
    botToken: string;
    secret: string;
    allowedUsers: Set<number>;
  };
  line?: {
    accessToken: string;
    channelSecret: string;
  };
}

const PORT = parseInt(process.env.PORT || "8443", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8444", 10);
const RELAY_AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || "b61940936a2625036d6faf7fe32c52b3"; // Same as webhook secret

// --- Keys Loader ---
function loadConfig(): Config {
  const keysDir = join(homedir(), ".pi-harness-runtime", "keys");
  const config: Config = {};

  // Telegram
  const telegramTokenPath = join(keysDir, "telegram-bot-token.txt");
  const telegramSecretPath = join(keysDir, "telegram-webhook-secret.txt");
  const telegramUsersPath = join(keysDir, "telegram-allowed-users.txt");

  if (existsSync(telegramTokenPath)) {
    const token = readFileSync(telegramTokenPath, "utf8").trim();
    const secret = existsSync(telegramSecretPath)
      ? readFileSync(telegramSecretPath, "utf8").trim()
      : process.env.TELEGRAM_WEBHOOK_SECRET || "";

    const allowedUsers = new Set<number>();
    if (existsSync(telegramUsersPath)) {
      const users = readFileSync(telegramUsersPath, "utf8").trim();
      for (const id of users.split(",").map((s) => parseInt(s.trim(), 10))) {
        if (!isNaN(id) && id > 0) allowedUsers.add(id);
      }
    }

    config.telegram = { botToken: token, secret, allowedUsers };
  }

  // LINE
  const lineTokenPath = join(keysDir, "line-access-token.txt");
  const lineSecretPath = join(keysDir, "line-channel-secret.txt");

  if (existsSync(lineTokenPath) && existsSync(lineSecretPath)) {
    config.line = {
      accessToken: readFileSync(lineTokenPath, "utf8").trim(),
      channelSecret: readFileSync(lineSecretPath, "utf8").trim(),
    };
  }

  return config;
}

// --- Telegram HMAC Verification (for future use with secret hash) ---
async function _verifyTelegramHmac(data: string, secret: string, hash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const expected = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
  return expected === hash;
}

// --- LINE Verification ---
async function verifyLINE(body: string, channelSecret: string, xLineSignature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(channelSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Buffer.from(signature).toString("base64");
  return expected === xLineSignature;
}

// --- Callback Queue (file-based fallback) ---
const QUEUE_FILE = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");
function queueCallback(callback: Record<string, unknown>) {
  appendFileSync(QUEUE_FILE, JSON.stringify({ ...callback, timestamp: new Date().toISOString() }) + "\n");
}

// --- WebSocket Relay ---
const wsClients = new Map<string, WebSocket>();

function broadcastCallback(callback: Record<string, unknown>) {
  const msg = JSON.stringify({ type: "callback", payload: callback });
  let count = 0;
  for (const ws of wsClients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      count++;
    }
  }
  return count;
}

function startWebSocketServer() {
  const wss = new WebSocketServer({ port: WS_PORT });
  
  wss.on("connection", (ws: WebSocket) => {
    const clientId = randomUUID();
    wsClients.set(clientId, ws);
    console.log(`[WS] Client connected: ${clientId}`);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth" && msg.payload === RELAY_AUTH_TOKEN) {
          ws.send(JSON.stringify({ type: "auth", payload: { success: true } }));
          console.log(`[WS] Client authenticated: ${clientId}`);
        }
      } catch (err) {
        console.error(`[WS] Invalid message from ${clientId}:`, err);
      }
    });

    ws.on("close", () => {
      wsClients.delete(clientId);
      console.log(`[WS] Client disconnected: ${clientId}`);
    });
  });

  console.log(`[WS] WebSocket server started on port ${WS_PORT}`);
}

// --- Telegram Handler ---
async function handleTelegram(req: IncomingMessage, res: ServerResponse, config: Config) {
  if (!config.telegram) {
    res.writeHead(404);
    res.end("Telegram not configured");
    return;
  }

  // Verify secret token
  const secretToken = req.headers["x-telegram-bot-api-secret-token"];
  if (secretToken !== config.telegram.secret) {
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

      const callback = {
        type: "telegram_callback",
        action,
        targetId,
        userId: from.id,
        username: from.username,
        messageId: query.message?.message_id,
      };

      // Broadcast via WebSocket
      const wsCount = broadcastCallback(callback);
      if (wsCount === 0) {
        // Fallback to file queue
        queueCallback(callback);
      }
      console.log(`[Telegram] Callback: ${action} ${targetId} from @${from.username || from.id} (WS clients: ${wsCount})`);

      // Acknowledge immediately
      await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: query.id }),
      });
    }

    res.writeHead(200);
    res.end("OK");
  } catch (err) {
    console.error("[Telegram] Error:", err);
    res.writeHead(500);
    res.end("Error");
  }
}

// --- LINE Handler ---
async function handleLINE(req: IncomingMessage, res: ServerResponse, config: Config) {
  if (!config.line) {
    res.writeHead(404);
    res.end("LINE not configured");
    return;
  }

  // Verify signature
  const signature = req.headers["x-line-signature"] as string;
  if (!signature) {
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
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const bodyJson = JSON.parse(body);
    const events = bodyJson.events || [];

    for (const event of events) {
      if (event.type === "postback") {
        const data = event.postback?.data || "";
        const colonIdx = data.indexOf(":");
        let action = data.slice(0, colonIdx !== -1 ? colonIdx : undefined);
        let targetId = colonIdx !== -1 ? data.slice(colonIdx + 1) : "";

        const callback = {
          type: "line_callback",
          action,
          targetId,
          userId: event.source?.userId,
          timestamp: new Date().toISOString(),
        };

        // Broadcast via WebSocket
        const wsCount = broadcastCallback(callback);
        if (wsCount === 0) {
          queueCallback(callback);
        }
        console.log(`[LINE] Postback: ${action} ${targetId} (WS clients: ${wsCount})`);
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
  } catch (err) {
    console.error("[LINE] Error:", err);
    res.writeHead(500);
    res.end("Error");
  }
}

// --- Main ---
const config = loadConfig();

console.log("===========================================");
console.log("Unified Webhook Server");
console.log("===========================================");
if (config.telegram) console.log("  /telegram - Telegram webhook");
if (config.line) console.log("  /line     - LINE webhook");
console.log("===========================================");

// Start WebSocket relay
startWebSocketServer();

// HTTP webhook server
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
    console.error("[Server] Error:", err);
    res.writeHead(500);
    res.end("Error");
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket relay on ws://0.0.0.0:${WS_PORT}`);
  console.log("Configure webhooks:");
  if (config.telegram) console.log(`  Telegram: https://webhook.bunchee.online/telegram`);
  if (config.line) console.log(`  LINE:     https://webhook.bunchee.online/line`);
});

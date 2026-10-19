#!/usr/bin/env bun
/**
 * Real-time Callback Relay Client
 * 
 * Connects to WebSocket server on VPS to receive callbacks instantly.
 * No file queue sync needed!
 * 
 * Usage:
 *   RELAY_WS_URL=wss://webhook.bunchee.online:8444 \
 *   RELAY_AUTH_TOKEN=change-me-in-production \
 *   bun run scripts/relay-client.ts
 */

import { WebSocket } from "ws";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Configuration
const RELAY_WS_URL = process.env.RELAY_WS_URL || "wss://webhook.bunchee.online:8444";
const RELAY_AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || "change-me-in-production";
const CALLBACK_QUEUE_FILE = join(homedir(), ".pi-harness-runtime", "callback-queue.jsonl");
const JOB_PIPE_FILE = join(homedir(), ".pi-harness-runtime", "job-commands.jsonl");

interface RelayMessage {
  type: string;
  payload: unknown;
}

interface CallbackPayload {
  type: "telegram_callback" | "line_callback";
  action: string;
  targetId: string;
  userId: number;
  username?: string;
  messageId?: number;
  timestamp: string;
}

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let authenticated = false;

function loadKeys() {
  const keysDir = join(homedir(), ".pi-harness-runtime", "keys");
  return {
    telegramBotToken: readFileSync(join(keysDir, "telegram-bot-token.txt"), "utf8").trim(),
    telegramAllowedUsers: readFileSync(join(keysDir, "telegram-allowed-users.txt"), "utf8").trim(),
  };
}

function writeToJobPipe(command: { command: string; jobId: string; userId: number; timestamp: string }): void {
  const line = JSON.stringify(command) + "\n";
  writeFileSync(JOB_PIPE_FILE, line, { flag: "a" });
  console.log(`[RelayClient] Wrote to job pipe: ${command.command} ${command.jobId}`);
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const keys = loadKeys();
  await fetch(`https://api.telegram.org/bot${keys.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function processCallback(callback: CallbackPayload): Promise<void> {
  console.log(`[RelayClient] Processing: ${callback.type} - ${callback.action} ${callback.targetId}`);

  switch (callback.action) {
    case "approve":
      writeToJobPipe({
        command: "resume",
        jobId: callback.targetId,
        userId: callback.userId,
        timestamp: new Date().toISOString(),
      });
      await sendTelegramMessage(callback.userId, `✅ Approved! Job ${callback.targetId} will resume.`);
      break;

    case "reject":
      writeToJobPipe({
        command: "cancel",
        jobId: callback.targetId,
        userId: callback.userId,
        timestamp: new Date().toISOString(),
      });
      await sendTelegramMessage(callback.userId, `❌ Rejected. Job ${callback.targetId} cancelled.`);
      break;

    case "sayhi":
      await sendTelegramMessage(
        callback.userId,
        "👋 Hi! Two-way communication working! (Real-time via WebSocket)"
      );
      break;

    default:
      console.log(`[RelayClient] Unknown action: ${callback.action}`);
  }
}

function connect(): void {
  console.log(`[RelayClient] Connecting to ${RELAY_WS_URL}...`);
  
  ws = new WebSocket(RELAY_WS_URL);

  ws.on("open", () => {
    console.log("[RelayClient] Connected!");
    reconnectDelay = 1000;
    
    // Authenticate
    ws!.send(JSON.stringify({ type: "auth", payload: RELAY_AUTH_TOKEN }));
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString()) as RelayMessage;
      
      switch (msg.type) {
        case "connected":
          console.log("[RelayClient] Server acknowledged connection");
          break;

        case "auth":
          const authResult = msg.payload as { success: boolean; error?: string };
          if (authResult.success) {
            authenticated = true;
            console.log("[RelayClient] Authenticated!");
          } else {
            console.error("[RelayClient] Auth failed:", authResult.error);
            ws?.close();
          }
          break;

        case "callback":
          if (!authenticated) break;
          await processCallback(msg.payload as CallbackPayload);
          break;

        case "pong":
          // Heartbeat response
          break;
      }
    } catch (err) {
      console.error("[RelayClient] Parse error:", err);
    }
  });

  ws.on("close", () => {
    authenticated = false;
    console.log(`[RelayClient] Disconnected. Reconnecting in ${reconnectDelay}ms...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Max 30s
  });

  ws.on("error", (err) => {
    console.error("[RelayClient] Error:", err.message);
  });
}

// Send ping every 30s to keep alive
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping", payload: {} }));
  }
}, 30000);

console.log("===========================================");
console.log("Real-time Callback Relay Client");
console.log("===========================================");
console.log(`Server: ${RELAY_WS_URL}`);
console.log("===========================================");

connect();

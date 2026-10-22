#!/usr/bin/env bun
/**
 * Unified Webhook Server — Handles Telegram, LINE, and WebSocket relay
 * 
 * Two-way streaming implementation using relay package:
 * - Snapshot + Live event pattern (t3code style)
 * - Typed message protocol
 * - Connection state machine
 * - Stream coalescing for high-frequency events
 *
 * Routes:
 *   /telegram → Telegram webhook handler
 *   /line     → LINE webhook handler
 *   /ws       → WebSocket relay (port 8444)
 *
 * Usage:
 *   bun run scripts/unified-webhook-server.ts
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "os";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createRelayServer } from "../packages/relay/src/server";
import { resolveRelayEndpoint } from "../packages/relay/src/relay-endpoint";
import { generateMessageId } from "../packages/relay/src/types";
import type { CallbackPayload } from "../packages/relay/src/types";
import type { RelayServerOptions } from "../packages/relay/src/server";

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
  /** Relay auth token used by WebSocket clients (null = relay stays off). */
  relayAuthToken: string | null;
}

const PORT = parseInt(process.env.PORT || "8443", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8444", 10);
/**
 * Resolve the relay auth token.
 *
 * The chain lives in packages/relay/src/relay-endpoint.ts and is SHARED with
 * the relay client, so the two sides can never disagree about the credential:
 * RELAY_AUTH_TOKEN env -> keys/relay-auth-token.txt ->
 * keys/telegram-webhook-secret.txt.
 *
 * Never hardcode a real token here; secrets live in key files. When no token
 * can be found the relay is NOT started at all - a placeholder token would
 * let anyone who knows it connect to the relay.
 */
function resolveAuthToken(keysDir: string): string | null {
  return resolveRelayEndpoint({ keysDir }).token;
}
const SERVER_VERSION = process.env.SERVER_VERSION || "1.0.0";

// --- Job Commands (for pi-harness polling) ---
const JOB_COMMANDS_FILE = join(process.env.HOME || homedir() || "/tmp", ".pi-harness-runtime", "job-commands.jsonl");

// --- Callback Queue (fallback when no relay client is connected) ---
const CALLBACK_QUEUE_FILE = join(process.env.HOME || homedir() || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");

/**
 * Persist a callback to disk when no WebSocket client is connected.
 * Without this, a click that lands while the relay client is offline is lost.
 */
function queueCallback(payload: CallbackPayload): void {
  try {
    const dir = join(CALLBACK_QUEUE_FILE, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(CALLBACK_QUEUE_FILE, JSON.stringify(payload) + "\n");
  } catch (err) {
    console.error("[Queue] Failed to persist callback:", err);
  }
}

interface JobCommand {
  command: string;
  jobId: string;
  userId: number;
  timestamp: string;
}

function readJobCommands(): JobCommand[] {
  if (!existsSync(JOB_COMMANDS_FILE)) return [];
  const content = readFileSync(JOB_COMMANDS_FILE, "utf-8");
  if (!content.trim()) return [];
  return content.trim().split("\n").map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function acknowledgeCommands(): void {
  writeFileSync(JOB_COMMANDS_FILE, "", "utf-8");
}

function writeJobCommand(cmd: Omit<JobCommand, "timestamp">): void {
  const line = JSON.stringify({ ...cmd, timestamp: new Date().toISOString() }) + "\n";
  writeFileSync(JOB_COMMANDS_FILE, line, { flag: "a" });
}

// --- Keys Loader ---
function loadConfig(): Config {
  const keysDir = join(homedir(), ".pi-harness-runtime", "keys");
  const config: Config = { relayAuthToken: resolveAuthToken(keysDir) };

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

// --- Parse Callback Data ---
function parseCallbackData(data: string): { action: string; targetId: string } {
  const colonIdx = data.indexOf(":");
  const underscoreIdx = data.indexOf("_");
  
  if (colonIdx !== -1) {
    return {
      action: data.slice(0, colonIdx),
      targetId: data.slice(colonIdx + 1).replace(/_+$/, ""),
    };
  } else if (underscoreIdx !== -1) {
    return {
      action: data.slice(0, underscoreIdx),
      targetId: data.slice(underscoreIdx + 1).replace(/_+$/, ""),
    };
  }
  
  return { action: data, targetId: "" };
}

// --- Create Callback Payload ---
function createCallbackPayload(
  type: "telegram_callback" | "line_callback",
  action: string,
  targetId: string,
  userId: number | string,
  username?: string,
  messageId?: number,
  callbackQueryId?: string,
  chatId?: number
): CallbackPayload {
  return {
    id: generateMessageId(),
    type,
    action,
    targetId,
    userId: typeof userId === "string" ? parseInt(userId, 10) || 0 : userId,
    username,
    messageId,
    callbackQueryId,
    chatId,
    timestamp: new Date().toISOString(),
  };
}

// --- Telegram Handler ---
async function handleTelegram(req: IncomingMessage, res: ServerResponse, config: Config, relayServer: ReturnType<typeof createRelayServer>) {
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
      const { action, targetId } = parseCallbackData(query.data || "");

      // Create typed callback payload with Telegram identity fields
      const callback = createCallbackPayload(
        "telegram_callback",
        action,
        targetId,
        from.id,
        from.username,
        query.message?.message_id,
        query.id,                    // callbackQueryId for Telegram acknowledgment
        query.message?.chat?.id      // chatId for greeting verification
      );

      // Broadcast via typed streaming relay (for relay-client WebSocket)
      const wsCount = relayServer.broadcastCallback(callback);

      // Fallback to file queue when no relay client is connected
      if (wsCount === 0) {
        queueCallback(callback);
      }

      // Write to job commands file (for pi-harness HTTP polling)
      writeJobCommand({
        command: action,
        jobId: targetId,
        userId: from.id,
      });

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
async function handleLINE(req: IncomingMessage, res: ServerResponse, config: Config, relayServer: ReturnType<typeof createRelayServer>) {
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
        const { action, targetId } = parseCallbackData(data);

        // Create typed callback payload
        const callback = createCallbackPayload(
          "line_callback",
          action,
          targetId,
          event.source?.userId || "unknown"
        );

        // Broadcast via typed streaming relay (for relay-client WebSocket)
        const wsCount = relayServer.broadcastCallback(callback);

        // Fallback to file queue when no relay client is connected
        if (wsCount === 0) {
          queueCallback(callback);
        }

        // Write to job commands file (for pi-harness HTTP polling)
        writeJobCommand({
          command: action,
          jobId: targetId,
          userId: parseInt(event.source?.userId || "0", 10) || 0,
        });

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
async function main() {
  const config = loadConfig();

  console.log("===========================================");
  console.log("Unified Webhook Server - Streaming v2");
  console.log("===========================================");
  if (config.telegram) console.log("  /telegram - Telegram webhook");
  if (config.line) console.log("  /line     - LINE webhook");
  console.log(`  HTTP:      http://0.0.0.0:${PORT}`);
  console.log(
    config.relayAuthToken
      ? `  WebSocket: ws://0.0.0.0:${WS_PORT}`
      : `  WebSocket: disabled (no relay auth token configured)`,
  );
  console.log("===========================================");

  // Create relay server with typed streaming
  const relayOptions: RelayServerOptions = {
    port: WS_PORT,
    host: "0.0.0.0",
    // Without a configured token the relay is never started - see below.
    authToken: config.relayAuthToken ?? "",
    serverVersion: SERVER_VERSION,
    onStateChange: (change: { previous: { state: string }; current: { state: string }; timestamp: string }) => {
      console.log(`[Relay] State: ${change.previous.state} → ${change.current.state}`);
    },
  };

  const relayServer = createRelayServer(relayOptions);

  // Start WebSocket relay
  if (config.relayAuthToken) {
    await relayServer.start();
    console.log("[Relay] WebSocket server started on port", WS_PORT);
  } else {
    // Fail closed: without a secret no client may connect. The HTTP webhook
    // keeps working and the callbacks are queued on disk instead.
    console.error(
      "[Relay] No relay auth token configured (RELAY_AUTH_TOKEN, keys/relay-auth-token.txt or keys/telegram-webhook-secret.txt) - the relay WebSocket server will NOT start; callbacks are queued on disk.",
    );
  }

  // HTTP webhook server
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    try {
      if (url.pathname === "/telegram" && req.method === "POST") {
        await handleTelegram(req, res, config, relayServer);
      } else if (url.pathname === "/line" && req.method === "POST") {
        await handleLINE(req, res, config, relayServer);
      } else if (url.pathname === "/api/pending-commands" && req.method === "GET") {
        // pi-harness polls this endpoint to get pending job commands
        const commands = readJobCommands();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ commands }));
      } else if (url.pathname === "/api/acknowledge-commands" && req.method === "POST") {
        // pi-harness acknowledges commands after processing
        acknowledgeCommands();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } else if (url.pathname === "/health") {
        // Keep the plain-text contract that external monitors check for "OK".
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      } else if (url.pathname === "/api/relay-status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          clients: relayServer.getClientCount(),
          running: relayServer.isRunning(),
          queued: existsSync(CALLBACK_QUEUE_FILE)
            ? readFileSync(CALLBACK_QUEUE_FILE, "utf-8").trim().split("\n").filter(Boolean).length
            : 0,
        }));
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
    console.log(`HTTP server running on http://0.0.0.0:${PORT}`);
    console.log("Configure webhooks:");
    if (config.telegram) console.log(`  Telegram: https://webhook.bunchee.online/telegram`);
    if (config.line) console.log(`  LINE:     https://webhook.bunchee.online/line`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await relayServer.stop();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(console.error);

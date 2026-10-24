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
import { createRelayServer } from "../packages/relay/dist/server.js";
import { resolveRelayEndpoint } from "../packages/relay/dist/relay-endpoint.js";
import { generateMessageId } from "../packages/relay/dist/types.js";
import type { CallbackPayload } from "../packages/relay/src/types";
import type { RelayServerOptions } from "../packages/relay/src/server";
// One implementation of the Telegram allow-list (env var, key file, legacy
// chat id) - the harness and this server must agree on who may write in.
import { getAllowedUserIds, isAuthorizedTelegramSender } from "../harness/telegram-auth";
// Centralized application logs: the harness ships redacted batches to
// /api/logs, the server queues them durably and a worker uploads them to
// Cloudflare R2.
import {
	IncidentStore,
	LogCredentialStore,
	LogIndexStore,
	LogIngestService,
	LogOutbox,
	LogOutboxWorker,
	createLogHttpHandler,
	serverObjectKey,
} from "../packages/logging/dist/server/index.js";
import type { OutboxEntry } from "../packages/logging/src/server/outbox";
import { loadR2Config, R2Client } from "./r2-storage";

// --- Configuration ---
interface Config {
  telegram?: {
    botToken: string;
    secret: string;
    allowedUsers: Set<number>;
    /** The configured chat id (used as the identity when no allow-list exists). */
    chatId?: number;
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

// --- Log ingest (centralized application logs) ---
const LOG_INGEST_DIR = join(process.env.HOME || homedir() || "/tmp", ".pi-harness-runtime", "logs", "inbound");
/** Durable queue of accepted batches (server side outbox). */
const LOG_OUTBOX_DIR = join(process.env.HOME || homedir() || "/tmp", ".pi-harness-runtime", "logs", "outbox");
/** Metadata index used by the query endpoint. */
const LOG_INDEX_DIR = join(process.env.HOME || homedir() || "/tmp", ".pi-harness-runtime", "logs", "index");
/** Durable storage of the derived incidents, one file per tenant and day. */
const LOG_INCIDENT_DIR = join(process.env.HOME || homedir() || "/tmp", ".pi-harness-runtime", "logs", "incidents");
/** Largest accepted ingest body (2 MB). A batch is NDJSON, so this is generous. */
const LOG_INGEST_MAX_BYTES = 2 * 1024 * 1024;
/** Largest accepted query body (64 KB is plenty for a filter object). */
const LOG_QUERY_MAX_BYTES = 64 * 1024;

/**
 * The ingest pipeline.
 *
 * The credential store decides whether the endpoint exists at all: without a
 * credential the endpoint refuses every write (fail closed) instead of
 * accepting anonymous batches.
 */
const logCredentials = LogCredentialStore.load();
const logOutbox = new LogOutbox({ dir: LOG_OUTBOX_DIR });
const logIndex = new LogIndexStore({ dir: LOG_INDEX_DIR });
const logIncidents = new IncidentStore({ dir: LOG_INCIDENT_DIR });
const logService = new LogIngestService({
  credentials: logCredentials,
  outbox: logOutbox,
  index: logIndex,
  // The derived incidents: a versioned, tenant scoped view of what is
  // actually going wrong.
  incidents: logIncidents,
});
/** The HTTP surface of the log service (ingest, query, diagnostics). */
const logHttpHandler = createLogHttpHandler({
  service: logService,
  outbox: logOutbox,
  index: logIndex,
  localCopyDir: LOG_INGEST_DIR,
});

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

/**
 * Read a request body with a hard size limit.
 *
 * Returns null when the body was too large (the response is already sent).
 */
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload one queued batch to R2.
 *
 * The worker calls this in the background: an R2 outage grows the queue
 * instead of blocking the ingest endpoint.
 */
async function uploadQueuedBatch(entry: OutboxEntry): Promise<void> {
  const r2Config = loadR2Config();
  if (!r2Config) throw new Error("R2 is not configured");
  const client = new R2Client(r2Config);
  const key = serverObjectKey({
    tenantId: entry.batch.tenantId,
    batchId: entry.batch.batchId,
    sentAt: entry.batch.sentAt,
  });
  const body = entry.batch.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await client.upload({ key, body, contentType: "application/x-ndjson" });
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
  const telegramChatIdPath = join(keysDir, "telegram-chat-id.txt");

  if (existsSync(telegramTokenPath)) {
    const token = readFileSync(telegramTokenPath, "utf8").trim();
    const secret = existsSync(telegramSecretPath)
      ? readFileSync(telegramSecretPath, "utf8").trim()
      : process.env.TELEGRAM_WEBHOOK_SECRET || "";

    // The allow-list has one implementation (harness/telegram-auth.ts): the
    // TELEGRAM_ALLOWED_USERS env var, telegram-allowed-users.txt or - as the
    // legacy fallback - telegram-chat-id.txt.
    const allowedUsers = getAllowedUserIds();

    // The chat id is the identity of a private chat with the bot: the user id
    // and the chat id are the same number there. It is the fallback when no
    // explicit allow-list exists.
    let chatId: number | undefined;
    if (existsSync(telegramChatIdPath)) {
      const parsed = parseInt(readFileSync(telegramChatIdPath, "utf8").trim(), 10);
      if (!isNaN(parsed) && parsed > 0) chatId = parsed;
    }

    config.telegram = { botToken: token, secret, allowedUsers, chatId };
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
  type: "telegram_callback" | "line_callback" | "telegram_message",
  action: string,
  targetId: string,
  userId: number | string,
  username?: string,
  messageId?: number,
  callbackQueryId?: string,
  chatId?: number,
  text?: string,
  isBot?: boolean
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
    text,
    isBot,
    timestamp: new Date().toISOString(),
  };
}

// --- Telegram Authorization ---
/**
 * Is the sender of an update allowed to drive the harness?
 *
 * Rules (fail closed):
 * 1. An explicit allow-list (telegram-allowed-users.txt) wins.
 * 2. Otherwise the configured chat id is the identity: in a private chat the
 *    user id and the chat id are the same number.
 * 3. Without any of them nobody is allowed - an open bot would let every
 *    Telegram user write into Pi.
 */
function isAuthorizedTelegramUser(
  config: Config,
  fromId: number | undefined,
): boolean {
  const telegram = config.telegram;
  if (!telegram) return false;
  // One implementation of the rule (harness/telegram-auth.ts) - the harness
  // and this server must agree on who may write in.
  return isAuthorizedTelegramSender(
    telegram.allowedUsers,
    telegram.chatId,
    fromId,
  );
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

      // An update without a sender (a channel post, an anonymous admin) has
      // no identity: acknowledge it, but never act on it.
      if (!from) {
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // Check authorization
      if (!isAuthorizedTelegramUser(config, from.id)) {
        console.log(`[Telegram] Rejected callback from unauthorized user ${from.id}`);
        // 200 + drop: a 403 makes Telegram retry the same update.
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // A bot may not press a button: it could otherwise approve a code
      // review or dismiss a task.
      if (from.is_bot === true) {
        console.log(`[Telegram] Rejected callback from bot ${from.id}`);
        res.writeHead(200);
        res.end("OK");
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
        query.message?.chat?.id,     // chatId for greeting verification
        undefined,                   // no text for a button callback
        from.is_bot === true         // the real bot flag
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

    // Handle a text message (the user typed something in the chat)
    if (update.message && !update.callback_query) {
      const message = update.message;
      const from = message.from;
      const text = typeof message.text === "string" ? message.text : "";

      // An update without a sender has no identity: acknowledge it, but never
      // act on it (a throw here would make Telegram retry the update).
      if (!from) {
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // A bot must never reach the agent: acknowledge it, but do not act.
      if (from.is_bot) {
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // Check authorization
      if (!isAuthorizedTelegramUser(config, from.id)) {
        console.log(`[Telegram] Rejected message from unauthorized user ${from.id}`);
        // 200 + drop: a 403 makes Telegram retry the same update.
        res.writeHead(200);
        res.end("OK");
        return;
      }

      if (text) {
        const payload = createCallbackPayload(
          "telegram_message",
          "message",
          // The target id must not carry the user text: it is written to the
          // log files of the client.
          `msg-${message.message_id ?? 0}`,
          from.id,
          from.username,
          message.message_id,
          undefined,                 // no callback query id for a text message
          message.chat?.id,          // chat id
          text,                      // the text itself
          from.is_bot === true       // the real bot flag
        );

        // Broadcast via typed streaming relay (for relay-client WebSocket)
        const wsCount = relayServer.broadcastCallback(payload);

        if (wsCount === 0) {
          // A text message has no consumer in the file queue (the callback
          // processor only understands the button actions), so it is NOT
          // persisted there: it would be user text on disk, never delivered.
          console.log(
            `[Telegram] Message from @${from.username || from.id} was NOT delivered: no relay client is connected`,
          );
        }

        // The text itself is user content: the log keeps the length only.
        console.log(
          `[Telegram] Message from @${from.username || from.id} (${text.length} chars, WS clients: ${wsCount})`,
        );
      }
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

        // Write to job commands file (for pi-harness HTTP polling).
        // Only the job commands belong there: an approval action resolves a
        // pending question and travels through the callback path, so the
        // job command queue must not receive it.
        if (action === "resume" || action === "cancel") {
          writeJobCommand({
            command: action,
            jobId: targetId,
            userId: parseInt(event.source?.userId || "0", 10) || 0,
          });
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
      } else if (
        url.pathname === "/api/logs" ||
        url.pathname === "/api/logs/query" ||
        url.pathname === "/api/logs/health"
      ) {
        // Centralized application logs: ingest, query and diagnostics.
        await logHttpHandler(req, res);
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

  // The outbox worker uploads the accepted batches to R2 in the background:
  // an R2 outage grows the queue instead of blocking the ingest endpoint.
  const outboxWorker = new LogOutboxWorker({ outbox: logOutbox, upload: uploadQueuedBatch });
  outboxWorker.start();
  if (!logService.configured) {
    console.error(
      "[LogIngest] No ingest credential configured (LOG_INGEST_TOKEN, keys/log-ingest-token.txt or keys/log-ingest-credentials.json) - /api/logs will refuse every write.",
    );
  } else {
    console.log(
      `[LogIngest] Ingest enabled - ${logOutbox.stats().pending} batch(es) queued, outbox at ${LOG_OUTBOX_DIR}`,
    );
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await outboxWorker.stop();
    await relayServer.stop();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(console.error);

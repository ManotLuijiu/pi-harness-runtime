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
// SECURITY: Require webhook secret - fail closed if not set
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
const CALLBACK_QUEUE_FILE = process.env.CALLBACK_QUEUE_FILE || join(process.env.HOME || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");
const PORT = parseInt(process.env.PORT || "3000", 10);

// --- Verify config ---
if (!BOT_TOKEN) {
  console.error("[TelegramWebhook] ERROR: TELEGRAM_BOT_TOKEN not set");
  console.error("[TelegramWebhook] Usage:");
  console.error("[TelegramWebhook]   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=xxx bun run scripts/telegram-webhook-server.ts");
  process.exit(1);
}

// SECURITY: Require webhook secret - fail closed in production
if (!WEBHOOK_SECRET) {
  console.error("[TelegramWebhook] ERROR: TELEGRAM_WEBHOOK_SECRET not set");
  console.error("[TelegramWebhook] SECURITY: Webhook secret is required for production");
  console.error("[TelegramWebhook] Usage:");
  console.error("[TelegramWebhook]   TELEGRAM_WEBHOOK_SECRET=<high-entropy-secret> bun run scripts/telegram-webhook-server.ts");
  process.exit(1);
}

// --- Authorization helpers ---
function getAllowedUserIds(): Set<number> {
  const ids = new Set<number>();

  // Priority 1: Environment variable
  const envUsers = process.env.TELEGRAM_ALLOWED_USERS;
  if (envUsers) {
    for (const part of envUsers.split(",")) {
      const num = parseInt(part.trim(), 10);
      if (!isNaN(num) && num > 0) ids.add(num);
    }
  }

  // Priority 2: Key file (telegram-allowed-users.txt)
  const allowedFile = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "keys", "telegram-allowed-users.txt");
  if (existsSync(allowedFile)) {
    const content = readFileSync(allowedFile, "utf8").trim();
    for (const part of content.split(",")) {
      const num = parseInt(part.trim(), 10);
      if (!isNaN(num) && num > 0) ids.add(num);
    }
  }

  // Priority 3: Legacy chat ID file
  const legacyFile = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "keys", "telegram-chat-id.txt");
  if (existsSync(legacyFile) && ids.size === 0) {
    const content = readFileSync(legacyFile, "utf8").trim();
    const num = parseInt(content, 10);
    if (!isNaN(num) && num > 0) ids.add(num);
  }

  return ids;
}

function isAuthorizedUser(userId: number): boolean {
  const allowed = getAllowedUserIds();
  // SECURITY: Fail closed - deny if no allowlist configured
  if (allowed.size === 0) {
    console.warn("[TelegramWebhook] SECURITY: No TELEGRAM_ALLOWED_USERS configured - denying access");
    return false;
  }
  return allowed.has(userId);
}

// SECURITY: Sanitize URLs from error messages
function sanitizeError(error: unknown): string {
  const msg = String(error);
  // Remove any bot token URLs
  return msg.replace(/https?:\/\/[^/]*\/bot[^/]+\/[^\s]*/gi, "[REDACTED_URL]");
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
  // Support both colon (approve:job-123) and underscore (approve_job-123) separators
  // Also handle Telegram's underscore padding (approve:job-123_)
  const cleanData = data.replace(/_+$/, ""); // Remove trailing underscores from Telegram padding
  
  // Split by first colon or underscore
  const colonIdx = cleanData.indexOf(":");
  const underscoreIdx = cleanData.indexOf("_");
  
  let action: string;
  let targetId: string;
  
  if (colonIdx !== -1 && (underscoreIdx === -1 || colonIdx < underscoreIdx)) {
    // Colon comes first or is the only separator
    action = cleanData.slice(0, colonIdx);
    targetId = cleanData.slice(colonIdx + 1);
  } else if (underscoreIdx !== -1) {
    // Underscore comes first or is the only separator
    action = cleanData.slice(0, underscoreIdx);
    targetId = cleanData.slice(underscoreIdx + 1);
  } else {
    // No separator found
    action = cleanData;
    targetId = "";
  }
  
  return { action, targetId };
}

// --- Job Commands Management ---
const JOB_COMMANDS_FILE = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "job-commands.jsonl");

interface JobCommand {
  command: string;
  jobId: string;
  userId: number;
  timestamp: string;
}

/**
 * Read unacknowledged job commands from file
 */
function readJobCommands(): JobCommand[] {
  try {
    if (!existsSync(JOB_COMMANDS_FILE)) {
      return [];
    }
    const content = readFileSync(JOB_COMMANDS_FILE, "utf-8");
    const lines = content.split("\n").filter(l => l.trim());
    const commands: JobCommand[] = [];
    
    for (const line of lines) {
      try {
        commands.push(JSON.parse(line));
      } catch {
        // Ignore parse errors
      }
    }
    return commands;
  } catch {
    return [];
  }
}

/**
 * Acknowledge (remove) processed job commands
 */
function acknowledgeJobCommands(jobIds: string[]): void {
  try {
    const commands = readJobCommands();
    const remaining = commands.filter(cmd => !jobIds.includes(cmd.jobId));
    
    if (remaining.length === 0) {
      // All commands processed - clear file
      writeFileSync(JOB_COMMANDS_FILE, "", "utf-8");
    } else {
      // Keep unacknowledged commands
      const newContent = remaining.map(cmd => JSON.stringify(cmd)).join("\n") + "\n";
      writeFileSync(JOB_COMMANDS_FILE, newContent, "utf-8");
    }
  } catch {
    // Ignore errors
  }
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

// --- Parse URL path ---
function parseUrlPath(url: string): { path: string } {
  const [pathPart] = url.split('?');
  return { path: pathPart };
}

// --- HTTP Request Handler ---
function handleRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  const { path } = parseUrlPath(req.url || '/');

  // CORS preflight - allow Telegram bot API and pi-harness clients
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    // Allow Telegram's servers and any pi-harness client
    const allowedOrigins = [
      "https://api.telegram.org",
      "https://web.telegram.org",
    ];
    const corsOrigin = allowedOrigins.includes(origin || "") ? origin || "" : "*";
    
    res.writeHead(204, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-telegram-bot-api-secret-token, Authorization",
    });
    res.end();
    return;
  }

  // --- API: Get pending commands (for pi-harness polling) ---
  if (req.method === "GET" && path === "/api/pending-commands") {
    // Verify API key header
    const apiKey = req.headers["authorization"]?.replace("Bearer ", "");
    if (apiKey !== WEBHOOK_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      // Read job commands from file
      const jobCommands = readJobCommands();
      // Restrict CORS to same origin or configured allowed origins
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
      const origin = req.headers.origin;
      const isAllowedOrigin = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
      const corsHeader = isAllowedOrigin ? (origin || '*') : '';

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": corsHeader,
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify({ commands: jobCommands }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    }
    return;
  }

  // --- API: Acknowledge (consume) commands ---
  if (req.method === "POST" && path === "/api/acknowledge-commands") {
    const apiKey = req.headers["authorization"]?.replace("Bearer ", "");
    if (apiKey !== WEBHOOK_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const { jobIds } = JSON.parse(body);
        if (Array.isArray(jobIds)) {
          acknowledgeJobCommands(jobIds);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
    return;
  }

  // --- Webhook: Only accept POST ---
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

        // SECURITY: Validate sender is authorized user
        if (!isAuthorizedUser(cq.from.id)) {
          console.warn(`[TelegramWebhook] Unauthorized user: ${cq.from.id} (${cq.from.username || cq.from.first_name})`);
          // Answer callback query to remove loading state
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: cq.id,
              text: "Unauthorized. Please contact the bot owner.",
            }),
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        console.log(`[TelegramWebhook] Callback: ${cq.data} from user_id=${cq.from.id}`);

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
      console.error("[TelegramWebhook] Error:", sanitizeError(err));
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
    console.log("[TelegramWebhook]   Configure webhook URL via environment or secret provider");
    console.log("[TelegramWebhook]   Then run: curl -X POST https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook -d json_with_secrets_removed");
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
    console.error(`[TelegramWebhook] Webhook setup failed: ${sanitizeError(result.description)}`);
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
  console.log(`Bot token: ${BOT_TOKEN ? '[REDACTED]' : 'MISSING'}`);
  console.log(`Webhook secret: ${WEBHOOK_SECRET ? '[REDACTED]' : 'MISSING'}`);
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

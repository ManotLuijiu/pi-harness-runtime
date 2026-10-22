#!/usr/bin/env bun
/**
 * Real-time Callback Relay Client - Two-way streaming
 * 
 * Uses the relay package's typed streaming protocol:
 * - Snapshot + Live event pattern (t3code style)
 * - Connection state machine with automatic reconnection
 * - Typed message handling
 * 
 * Usage:
 *   bun run scripts/relay-client.ts
 *
 * The endpoint and the token are resolved from the environment and the key
 * files (see resolveRelayEndpoint); no URL or token has to be passed in.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RelayClient } from "../packages/relay/src/client";
import { describeRelayEndpoint, resolveRelayEndpoint } from "../packages/relay/src/relay-endpoint";
import type { CallbackPayload, SnapshotMessage } from "../packages/relay/src/types";

// Configuration
// The relay endpoint is resolved from the SAME sources the relay server uses
// (env -> dedicated key file -> the telegram webhook url/secret), so the
// client and the server always agree on the URL and the token.
// The token value is never logged - only the source it came from.
const KEYS_DIR = join(homedir(), ".pi-harness-runtime", "keys");
const RELAY_ENDPOINT = resolveRelayEndpoint({ keysDir: KEYS_DIR });
// The resolver already consulted the environment - a value it rejected must
// NOT be re-used here, otherwise the client would connect to an endpoint the
// resolver deliberately skipped.
const RELAY_WS_URL = RELAY_ENDPOINT.url ?? "";
const RELAY_AUTH_TOKEN = RELAY_ENDPOINT.token ?? "";
const JOB_PIPE_FILE = join(homedir(), ".pi-harness-runtime", "job-commands.jsonl");

// ============================================================================
// Telegram Integration
// ============================================================================

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
  console.log(`[Client] Wrote to job pipe: ${command.command} ${command.jobId}`);
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const keys = loadKeys();
  await fetch(`https://api.telegram.org/bot${keys.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ============================================================================
// Callback Processing
// ============================================================================

async function processCallback(callback: CallbackPayload): Promise<void> {
  console.log(`[Client] Processing: ${callback.type} - ${callback.action} ${callback.targetId}`);

  switch (callback.action) {
    case "approve":
      writeToJobPipe({
        command: "resume",
        jobId: callback.targetId,
        userId: callback.userId,
        timestamp: new Date().toISOString(),
      });
      await sendTelegramMessage(callback.userId, `Approved! Job ${callback.targetId} will resume.`);
      break;

    case "reject":
      writeToJobPipe({
        command: "cancel",
        jobId: callback.targetId,
        userId: callback.userId,
        timestamp: new Date().toISOString(),
      });
      await sendTelegramMessage(callback.userId, `Rejected. Job ${callback.targetId} cancelled.`);
      break;

    case "sayhi":
      await sendTelegramMessage(
        callback.userId,
        "Hi! Two-way streaming communication working!"
      );
      break;

    default:
      console.log(`[Client] Unknown action: ${callback.action}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Validate BEFORE printing the banner - an unconfigured run must not print
  // an empty "Server:" line.
  if (!RELAY_WS_URL || !RELAY_AUTH_TOKEN) {
    console.error("[Client] Relay endpoint not configured");
    console.error(`[Client] ${RELAY_ENDPOINT.missing.join("; ")}`);
    process.exit(1);
  }

  console.log("===========================================");
  console.log("Real-time Callback Relay Client - Streaming v2");
  console.log("===========================================");
  console.log(`Server: ${RELAY_WS_URL}`);
  console.log(`Endpoint: ${describeRelayEndpoint(RELAY_ENDPOINT)}`);
  console.log("===========================================");

  // Create client with typed callbacks
  const client = new RelayClient(
    {
      serverUrl: RELAY_WS_URL,
      token: RELAY_AUTH_TOKEN,
      keepAlive: 30000,
    },
    {
      onConnected: (sessionId) => {
        console.log(`[Client] Connected! Session: ${sessionId}`);
      },

      onDisconnected: () => {
        console.log("[Client] Disconnected");
      },

      onSnapshot: (snapshot: SnapshotMessage["payload"]) => {
        console.log(`[Client] Snapshot received:`);
        console.log(`  - Session: ${snapshot.sessionId}`);
        console.log(`  - Version: ${snapshot.serverVersion}`);
        console.log(`  - Connected clients: ${snapshot.connectedClients}`);
        console.log(`  - Recent callbacks: ${snapshot.recentCallbacks.length}`);
        
        // Process any recent callbacks from snapshot
        for (const callback of snapshot.recentCallbacks) {
          processCallback(callback).catch(console.error);
        }
      },

      onSynchronized: () => {
        console.log("[Client] Synchronized - receiving live events");
      },

      onCallback: (callback: CallbackPayload) => {
        console.log(`[Client] Live callback: ${callback.action} ${callback.targetId}`);
        processCallback(callback).catch(console.error);
      },

      onStatus: (status) => {
        console.log(`[Client] Status [${status.kind}]: ${status.code} - ${status.message}`);
      },

      onError: (error) => {
        console.error("[Client] Error:", error.message);
      },

      onStateChange: (change) => {
        const prev = change.previous.state;
        const curr = change.current.state;
        if (prev !== curr) {
          console.log(`[Client] State: ${prev} → ${curr}`);
        }
      },
    }
  );

  // Handle graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect
  try {
    await client.connect();
    console.log("[Client] Connection established!");
    
    // Keep running
    await new Promise(() => {});
  } catch (err) {
    console.error("[Client] Failed to connect:", err);
    process.exit(1);
  }
}

main();

#!/usr/bin/env bun
/**
 * Telegram Callback Queue Processor — RFC-0022
 *
 * Polls the callback queue file and processes approve/reject actions.
 * Run this alongside the webhook server.
 *
 * Usage:
 *   bun run scripts/telegram-callback-processor.ts
 *
 * Or import as a module:
 *   import { createCallbackProcessor } from "./scripts/telegram-callback-processor.ts";
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CallbackQueueItem {
  timestamp: string;
  queryId: string;
  userId: number;
  username?: string;
  data: string;
  action: string;
  targetId: string;
}

export interface CallbackProcessorConfig {
  queueFile: string;
  onApprove?: (targetId: string, item: CallbackQueueItem) => Promise<void>;
  onReject?: (targetId: string, item: CallbackQueueItem) => Promise<void>;
  onUnknown?: (action: string, targetId: string, item: CallbackQueueItem) => void;
  pollIntervalMs?: number;
}

const DEFAULT_QUEUE_FILE = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");

/**
 * Process pending callbacks from the queue file.
 * Returns the number of callbacks processed.
 */
export async function processCallbacks(config: CallbackProcessorConfig): Promise<number> {
  const { queueFile = DEFAULT_QUEUE_FILE, onApprove, onReject, onUnknown } = config;

  if (!existsSync(queueFile)) {
    return 0;
  }

  const content = readFileSync(queueFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  if (lines.length === 0) {
    return 0;
  }

  let processed = 0;

  // Read and clear queue
  require("node:fs").writeFileSync(queueFile, "", "utf-8");

  for (const line of lines) {
    try {
      const item: CallbackQueueItem = JSON.parse(line);

      switch (item.action) {
        case "approve":
          if (onApprove) {
            await onApprove(item.targetId, item);
          } else {
            console.log(`[CallbackProcessor] Approve: ${item.targetId} (no handler)`);
          }
          break;

        case "reject":
          if (onReject) {
            await onReject(item.targetId, item);
          } else {
            console.log(`[CallbackProcessor] Reject: ${item.targetId} (no handler)`);
          }
          break;

        default:
          if (onUnknown) {
            onUnknown(item.action, item.targetId, item);
          } else {
            console.log(`[CallbackProcessor] Unknown action: ${item.action}_${item.targetId}`);
          }
      }

      processed++;
    } catch (err) {
      console.error("[CallbackProcessor] Failed to parse line:", line, err);
    }
  }

  return processed;
}

/**
 * Start polling the callback queue.
 * Returns a stop function.
 */
export function startCallbackPolling(config: CallbackProcessorConfig): () => void {
  const intervalMs = config.pollIntervalMs || 1000;
  let stopped = false;

  const poll = async () => {
    while (!stopped) {
      await processCallbacks(config);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  poll().catch(console.error);

  return () => {
    stopped = true;
  };
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("=".repeat(60));
  console.log("Telegram Callback Queue Processor");
  console.log("=".repeat(60));

  const queueFile = process.env.CALLBACK_QUEUE_FILE || DEFAULT_QUEUE_FILE;
  console.log(`Queue file: ${queueFile}`);
  console.log(`Poll interval: 1s`);
  console.log("=".repeat(60));
  console.log("Processing callbacks...");
  console.log("(Press Ctrl+C to stop)");
  console.log("");

  const stop = startCallbackPolling({
    queueFile,
    onApprove: async (jobId) => {
      console.log(`✅ APPROVE: ${jobId}`);
    },
    onReject: async (jobId) => {
      console.log(`❌ REJECT: ${jobId}`);
    },
  });

  process.on("SIGINT", () => {
    console.log("\nStopping...");
    stop();
    process.exit(0);
  });
}

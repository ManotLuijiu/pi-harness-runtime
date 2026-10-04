#!/usr/bin/env bun
/**
 * Telegram Callback Queue Processor — RFC-0022
 *
 * Polls the callback queue file and processes approve/reject actions.
 * Writes job commands to a pipe file that pi-harness watches.
 *
 * Usage:
 *   bun run scripts/telegram-callback-processor.ts
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
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
  jobPipeFile: string;
  onApprove?: (targetId: string, item: CallbackQueueItem) => Promise<void>;
  onReject?: (targetId: string, item: CallbackQueueItem) => Promise<void>;
  onUnknown?: (action: string, targetId: string, item: CallbackQueueItem) => void;
  pollIntervalMs?: number;
}

const DEFAULT_QUEUE_FILE = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "callback-queue.jsonl");
const DEFAULT_PIPE_FILE = join(process.env.HOME || "/tmp", ".pi-harness-runtime", "job-commands.jsonl");

// Global config for CLI
let config: CallbackProcessorConfig;

/**
 * Process pending callbacks from the queue file.
 * Returns the number of callbacks processed.
 */
export async function processCallbacks(): Promise<number> {
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
  writeFileSync(queueFile, "", "utf-8");

  for (const line of lines) {
    try {
      const item: CallbackQueueItem = JSON.parse(line);

      switch (item.action) {
        case "approve": {
          console.log(`✅ APPROVE: ${item.targetId} (from ${item.username || item.userId})`);
          
          // Write to job pipe for pi-harness to consume
          writeToJobPipe({ command: "resume", jobId: item.targetId, userId: item.userId, timestamp: new Date().toISOString() });
          
          if (onApprove) {
            await onApprove(item.targetId, item);
          }
          break;
        }

        case "reject": {
          console.log(`❌ REJECT: ${item.targetId} (from ${item.username || item.userId})`);
          
          // Write to job pipe for pi-harness to consume
          writeToJobPipe({ command: "cancel", jobId: item.targetId, userId: item.userId, timestamp: new Date().toISOString() });
          
          if (onReject) {
            await onReject(item.targetId, item);
          }
          break;
        }

        default: {
          console.log(`❓ UNKNOWN: ${item.action}_${item.targetId}`);
          if (onUnknown) {
            onUnknown(item.action, item.targetId, item);
          }
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
 * Write job command to pipe file for pi-harness to consume
 */
function writeToJobPipe(command: { command: string; jobId: string; userId: number; timestamp: string }): void {
  const { jobPipeFile } = config;
  if (!jobPipeFile) return;
  
  try {
    appendFileSync(jobPipeFile, JSON.stringify(command) + "\n");
    console.log(`[CallbackProcessor] Wrote to pipe: ${command.command} ${command.jobId}`);
  } catch (err) {
    console.error("[CallbackProcessor] Failed to write to pipe:", err);
  }
}

/**
 * Start polling the callback queue.
 * Returns a stop function.
 */
export function startCallbackPolling(): () => void {
  const intervalMs = config.pollIntervalMs || 1000;
  let stopped = false;

  const poll = async () => {
    while (!stopped) {
      await processCallbacks();
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
  const queueFile = process.env.CALLBACK_QUEUE_FILE || DEFAULT_QUEUE_FILE;
  const jobPipeFile = process.env.JOB_PIPE_FILE || DEFAULT_PIPE_FILE;
  
  console.log("=".repeat(60));
  console.log("Telegram Callback Queue Processor");
  console.log("=".repeat(60));
  console.log(`Queue file: ${queueFile}`);
  console.log(`Job pipe file: ${jobPipeFile}`);
  console.log(`Poll interval: 1s`);
  console.log("=".repeat(60));
  console.log("Processing callbacks...");
  console.log("(Press Ctrl+C to stop)");
  console.log("");

  config = {
    queueFile,
    jobPipeFile,
    onApprove: async (jobId) => {
      console.log(`[Callback] Approved: ${jobId}`);
    },
    onReject: async (jobId) => {
      console.log(`[Callback] Rejected: ${jobId}`);
    },
  };

  const stop = startCallbackPolling();

  process.on("SIGINT", () => {
    console.log("\nStopping...");
    stop();
    process.exit(0);
  });
}

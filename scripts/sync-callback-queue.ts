#!/usr/bin/env bun
/**
 * Syncs callback queue from VPS to local for processing.
 * Run this alongside telegram-callback-processor.ts
 * 
 * Usage:
 *   bun run scripts/sync-callback-queue.ts
 * 
 * Or set up a cron job:
 *   * * * * * bun /home/user/pi-harness-runtime/scripts/sync-callback-queue.ts
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const VPS_HOST = process.env.VPS_HOST || "frappe@217.216.37.251";
const VPS_QUEUE = "/home/user/.pi-harness-runtime/callback-queue.jsonl";
const LOCAL_QUEUE = join(process.env.HOME || "/home/user", ".pi-harness-runtime", "callback-queue.jsonl");

function syncQueue(): number {
  try {
    // SSH to get VPS queue content
    const vpsQueueContent = execSync(`ssh -o BatchMode=yes ${VPS_HOST} "cat ${VPS_QUEUE}"`, { encoding: "utf8" });

    if (!vpsQueueContent.trim()) {
      return 0; // Nothing to sync
    }

    // Append to local queue
    const existing = existsSync(LOCAL_QUEUE) ? readFileSync(LOCAL_QUEUE, "utf8") : "";
    const newQueue = existing + vpsQueueContent;
    writeFileSync(LOCAL_QUEUE, newQueue);

    // Clear VPS queue
    execSync(`ssh -o BatchMode=yes ${VPS_HOST} "truncate -s 0 ${VPS_QUEUE}"`);

    const count = vpsQueueContent.split("\n").filter(l => l.trim()).length;
    if (count > 0) {
      console.log(`[Sync] Synced ${count} callback(s) from VPS`);
    }
    return count;
  } catch (err) {
    console.error("[Sync] Error:", err);
    return 0;
  }
}

// Run once and exit (for cron) unless --watch is passed
const isWatch = process.argv.includes("--watch");

if (isWatch) {
  console.log("[Sync] Watching VPS queue every 500ms...");
  setInterval(syncQueue, 500);
} else {
  syncQueue();
}

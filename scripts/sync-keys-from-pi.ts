#!/usr/bin/env bun
/**
 * Sync Keys from pi.dev to ~/.pi-harness-runtime/keys/
 *
 * This script reads API keys from ~/.pi/agent/auth.json and syncs them
 * to ~/.pi-harness-runtime/keys/ so the daemon can use them.
 *
 * Usage:
 *   bun run scripts/sync-keys-from-pi.ts
 *
 * Or import and call:
 *   import { syncAllKeys } from "./sync-keys-from-pi.ts";
 *   syncAllKeys();
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Paths
const PI_AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");
const KEYS_DIR = join(homedir(), ".pi-harness-runtime", "keys");

// Key mappings: pi provider name -> key file name
// Note: openai-codex uses OAuth access token (not api_key)
const KEY_MAPPINGS: Record<string, string> = {
  // Model API keys (for daemon loop)
  minimax: "minimax-api-key.txt",
  zai: "glm-api-key.txt", // zai = GLM for review
  "openai-codex": "planner-api-key.txt", // OpenAI OAuth access token as planner

  // Other services
  qdrant: "qdrant-api-key.txt",
  paperclip: "paperclip-api-key.txt",
};

// Environment variable mappings: key file name -> env variable name
const ENV_MAPPINGS: Record<string, string> = {
  "minimax-api-key.txt": "MINIMAX_API_KEY",
  "glm-api-key.txt": "GLM_API_KEY",
  "planner-api-key.txt": "PLANNER_API_KEY",
  "planner-model.txt": "PLANNER_MODEL",
  "planner-base-url.txt": "PLANNER_BASE_URL",
};

/**
 * Read pi.dev auth.json
 */
function readPiAuth(): Record<string, { type?: string; key?: string; access?: string }> | null {
  try {
    if (!existsSync(PI_AUTH_FILE)) {
      console.log(`[sync-keys] pi.dev auth file not found: ${PI_AUTH_FILE}`);
      return null;
    }
    const content = readFileSync(PI_AUTH_FILE, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error(`[sync-keys] Failed to read pi.dev auth: ${err}`);
    return null;
  }
}

/**
 * Get API key from auth entry
 */
function getKeyFromEntry(entry: { type?: string; key?: string; access?: string }): string | null {
  if (entry.type === "api_key" && entry.key) {
    return entry.key;
  }
  if (entry.type === "oauth" && entry.access) {
    return entry.access; // Use OAuth access token
  }
  return null;
}

/**
 * Sync a single key file
 */
function syncKey(providerName: string, filename: string): boolean {
  const auth = readPiAuth();
  if (!auth) return false;

  // Try different case variations of provider name
  const keys = [providerName, providerName.toLowerCase(), providerName.replace(/-/g, "").toLowerCase()];
  
  for (const key of keys) {
    if (auth[key]?.key) {
      const entry = auth[key];
      const apiKey = getKeyFromEntry(entry);
      if (apiKey) {
        const filepath = join(KEYS_DIR, filename);
        const currentKey = existsSync(filepath) ? readFileSync(filepath, "utf8").trim() : null;

        if (currentKey !== apiKey) {
          writeFileSync(filepath, apiKey);
          const envVar = ENV_MAPPINGS[filename];
          console.log(`[sync-keys] Synced ${providerName} -> ${filename}${envVar ? ` (${envVar})` : ""}`);
          return true;
        } else {
          console.log(`[sync-keys] ${filename} already up to date`);
          return true;
        }
      }
    }
  }
  
  console.log(`[sync-keys] No key found for ${providerName} in pi.dev auth`);
  return false;
}

/**
 * Create default config files for required but missing keys
 */
function createDefaultConfigs(): void {
  // Planner defaults
  const plannerModelFile = join(KEYS_DIR, "planner-model.txt");
  if (!existsSync(plannerModelFile)) {
    writeFileSync(plannerModelFile, "gpt-4o");
    console.log(`[sync-keys] Created ${plannerModelFile} (default: gpt-4o)`);
  }

  const plannerBaseUrlFile = join(KEYS_DIR, "planner-base-url.txt");
  if (!existsSync(plannerBaseUrlFile)) {
    writeFileSync(plannerBaseUrlFile, "https://api.openai.com/v1");
    console.log(`[sync-keys] Created ${plannerBaseUrlFile} (default: OpenAI)`);
  }

  // GLM defaults (zai)
  const glmModelFile = join(KEYS_DIR, "glm-model.txt");
  if (!existsSync(glmModelFile)) {
    writeFileSync(glmModelFile, "glm-4");
    console.log(`[sync-keys] Created ${glmModelFile} (default: glm-4)`);
  }

  const glmBaseUrlFile = join(KEYS_DIR, "glm-base-url.txt");
  if (!existsSync(glmBaseUrlFile)) {
    writeFileSync(glmBaseUrlFile, "https://api.z.ai/api/v1");
    console.log(`[sync-keys] Created ${glmBaseUrlFile} (default: z.ai)`);
  }

  // MiniMax defaults
  const minimaxModelFile = join(KEYS_DIR, "minimax-model.txt");
  if (!existsSync(minimaxModelFile)) {
    writeFileSync(minimaxModelFile, "MiniMax-Text-01");
    console.log(`[sync-keys] Created ${minimaxModelFile} (default: MiniMax-Text-01)`);
  }

  const minimaxBaseUrlFile = join(KEYS_DIR, "minimax-base-url.txt");
  if (!existsSync(minimaxBaseUrlFile)) {
    writeFileSync(minimaxBaseUrlFile, "https://api.minimax.chat/v1");
    console.log(`[sync-keys] Created ${minimaxBaseUrlFile} (default: minimax.chat)`);
  }
}

/**
 * Sync all keys from pi.dev to keys directory
 */
export function syncAllKeys(): void {
  console.log("=== Sync Keys from pi.dev ===");
  console.log(`Keys directory: ${KEYS_DIR}`);

  // Ensure keys directory exists
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
    console.log(`[sync-keys] Created keys directory`);
  }

  // Sync each key
  let synced = 0;
  for (const [provider, filename] of Object.entries(KEY_MAPPINGS)) {
    if (syncKey(provider, filename)) {
      synced++;
    }
  }

  // Create default configs for missing required keys
  createDefaultConfigs();

  console.log(`\n=== Done: ${synced} key(s) synced ===`);
  console.log("\nNext steps:");
  console.log("1. Add PLANNER_API_KEY manually if using OpenAI as planner:");
  console.log("   echo 'sk-xxx' > ~/.pi-harness-runtime/keys/planner-api-key.txt");
  console.log("2. Restart the daemon:");
  console.log("   bun run harness/langchain/run.ts --daemon");
}

// Auto-run if executed directly
syncAllKeys();

/**
 * API Key Resolver - Auto-discover API keys from pi.dev config
 *
 * Scans ~/.pi/agent/auth.json to find API keys for:
 * - zai (GLM)
 * - minimax
 * - And other providers
 *
 * Then copies to ~/.pi-harness-runtime/keys/ for easy access.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/** pi.dev auth file location */
const PI_AUTH_FILE = join(process.env.HOME || "/home/frappe", ".pi", "agent", "auth.json");

/** Our keys directory */
const KEYS_DIR = join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "keys");

/** Key file mappings */
const KEY_MAPPINGS: Record<string, string> = {
  zai: "zai-api-key.txt",
  minimax: "minimax-api-key.txt",
  openai: "openai-api-key.txt",
  anthropic: "anthropic-api-key.txt",
};

/** pi.dev auth file structure */
interface PiAuth {
  [provider: string]: {
    type?: string;
    key?: string;
    access?: string;
  };
}

/**
 * Read API keys from pi.dev auth.json
 */
export function readPiAuth(): PiAuth | null {
  try {
    if (!existsSync(PI_AUTH_FILE)) {
      return null;
    }
    const content = readFileSync(PI_AUTH_FILE, "utf-8");
    return JSON.parse(content) as PiAuth;
  } catch {
    return null;
  }
}

/**
 * Get specific provider's API key from pi.dev auth
 */
export function getProviderKey(provider: string): string | null {
  const auth = readPiAuth();
  if (!auth || !auth[provider]) {
    return null;
  }

  // For api_key type, use the key directly
  if (auth[provider].type === "api_key" && auth[provider].key) {
    return auth[provider].key ?? null;
  }

  // For oauth type, could return access token (but usually not needed)
  // if (auth[provider].type === "oauth" && auth[provider].access) {
  //   return auth[provider].access ?? null;
  // }

  return null;
}

/**
 * Sync API keys from pi.dev to our keys directory
 * This ensures we always have the latest keys without re-configuration
 */
export function syncApiKeysToKeysDir(): void {
  const auth = readPiAuth();
  if (!auth) {
    return;
  }

  // Ensure keys directory exists
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Sync each provider
  for (const [provider, filename] of Object.entries(KEY_MAPPINGS)) {
    if (auth[provider]?.type === "api_key" && auth[provider].key) {
      const filepath = join(KEYS_DIR, filename);
      const currentKey = existsSync(filepath)
        ? readFileSync(filepath, "utf-8").trim()
        : null;

      // Only write if key changed or file doesn't exist
      if (currentKey !== auth[provider].key) {
        writeFileSync(filepath, auth[provider].key!);
        console.log(`[api-key-resolver] Synced ${provider} key to ${filepath}`);
      }
    }
  }
}

/**
 * Get API key with auto-sync fallback
 * Priority: 1. Keys file 2. pi.dev auth.json 3. Environment variable
 */
export function resolveApiKey(
  provider: "zai" | "minimax" | "openai" | "anthropic",
  envVar?: string
): string | null {
  // 1. Try environment variable first
  if (envVar && process.env[envVar]) {
    return process.env[envVar] ?? null;
  }

  // 2. Try our keys directory
  const filename = KEY_MAPPINGS[provider];
  if (filename) {
    const filepath = join(KEYS_DIR, filename);
    if (existsSync(filepath)) {
      const key = readFileSync(filepath, "utf-8").trim();
      if (key.length > 10) {
        return key;
      }
    }
  }

  // 3. Try pi.dev auth.json
  const authKey = getProviderKey(provider);
  if (authKey) {
    // Sync to keys dir for future use
    syncApiKeysToKeysDir();
    return authKey;
  }

  return null;
}

/**
 * Auto-initialize: sync keys on module load
 */
syncApiKeysToKeysDir();

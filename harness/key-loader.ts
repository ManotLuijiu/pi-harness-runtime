/**
 * Key Loader — Loads API keys from ~/.pi-harness-runtime/keys/ into process.env
 *
 * Usage:
 *   import { loadKeys } from "./key-loader.js";
 *   loadKeys(); // Loads all keys into process.env
 *
 * Environment variables set:
 *   TELEGRAM_BOT_TOKEN    → telegram-bot-token.txt
 *   TELEGRAM_CHAT_ID      → telegram-chat-id.txt
 *   TELEGRAM_WEBHOOK_URL  → telegram-webhook-url.txt
 *   TELEGRAM_WEBHOOK_SECRET → telegram-webhook-secret.txt
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEYS_DIR = join(homedir(), ".pi-harness-runtime", "keys");

const KEY_FILE_MAP: Record<string, string> = {
	TELEGRAM_BOT_TOKEN: "telegram-bot-token.txt",
	TELEGRAM_CHAT_ID: "telegram-chat-id.txt",
	TELEGRAM_WEBHOOK_URL: "telegram-webhook-url.txt",
	TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret.txt",
};

/**
 * Load all keys from ~/.pi-harness-runtime/keys/ into process.env
 * Only sets env vars that are not already set (allows CLI args to override)
 */
export function loadKeys(): void {
	if (!existsSync(KEYS_DIR)) {
		console.warn(`[key-loader] Keys directory not found: ${KEYS_DIR}`);
		return;
	}

	let loadedCount = 0;
	for (const [envVar, filename] of Object.entries(KEY_FILE_MAP)) {
		// Skip if already set via environment
		if (process.env[envVar]) {
			console.log(`[key-loader] ${envVar} already set via env, skipping`);
			continue;
		}

		const filePath = join(KEYS_DIR, filename);
		if (existsSync(filePath)) {
			const value = readFileSync(filePath, "utf8").trim();
			if (value) {
				process.env[envVar] = value;
				loadedCount++;
				console.log(`[key-loader] Loaded ${envVar} from ${filename}`);
			}
		}
	}

	if (loadedCount > 0) {
		console.log(`[key-loader] Loaded ${loadedCount} key(s) from ${KEYS_DIR}`);
	}
}

/**
 * Get a specific key by name (without .txt extension)
 */
export function getKey(keyName: string): string | undefined {
	const filePath = join(KEYS_DIR, `${keyName}.txt`);
	if (existsSync(filePath)) {
		return readFileSync(filePath, "utf8").trim();
	}
	return undefined;
}

export default loadKeys;

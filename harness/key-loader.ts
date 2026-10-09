/**
 * Key Loader — Unified credential loading
 *
 * Loads API keys from Infisical (via Varlock) with file fallback.
 * Priority: Infisical > Environment > Key Files
 *
 * Environment variables set:
 *   Jev:          TYPESAFE_API_KEY, OPENROUTER_API_KEY
 *   Telegram:     TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET
 *   Honcho:       HONCHO_API_KEY
 *   Qdrant:       QDRANT_CLUSTER_ENDPOINT, QDRANT_API_KEY, QDRANT_COLLECTION
 *   Embeddings:   OPENAI_API_KEY
 *   Planners:     PLANNER_API_KEY, PLANNER_BASE_URL, PLANNER_MODEL
 *                  GLM_API_KEY, GLM_BASE_URL, GLM_MODEL
 *                  MINIMAX_API_KEY, MINIMAX_BASE_URL, MINIMAX_MODEL
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isConfigured, loadConfig } from "./infisical-config.js";
import { getSecretProvider, SecretProvider } from "./secret-provider.js";

const KEYS_DIR = join(homedir(), ".pi-harness-runtime", "keys");

/**
 * Key file mapping
 */
const KEY_FILE_MAP: Record<string, string> = {
	// Jev keys
	TYPESAFE_API_KEY: "typesafe-api-key.txt",
	OPENROUTER_API_KEY: "openrouter-api-key.txt",

	// Telegram keys
	TELEGRAM_BOT_TOKEN: "telegram-bot-token.txt",
	TELEGRAM_CHAT_ID: "telegram-chat-id.txt",
	TELEGRAM_WEBHOOK_URL: "telegram-webhook-url.txt",
	TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret.txt",

	// Honcho keys
	HONCHO_API_KEY: "honcho-api-key.txt",

	// Qdrant keys
	QDRANT_CLUSTER_ENDPOINT: "qdrant-cluster-endpoint.txt",
	QDRANT_API_KEY: "qdrant-api-key.txt",
	QDRANT_COLLECTION: "qdrant-collection.txt",

	// Embeddings
	OPENAI_API_KEY: "openai-api-key.txt",

	// Planner keys
	PLANNER_API_KEY: "planner-api-key.txt",
	PLANNER_MODEL: "planner-model.txt",
	PLANNER_BASE_URL: "planner-base-url.txt",

	// GLM keys
	GLM_API_KEY: "glm-api-key.txt",
	GLM_MODEL: "glm-model.txt",
	GLM_BASE_URL: "glm-base-url.txt",

	// Minimax keys
	MINIMAX_API_KEY: "minimax-api-key.txt",
	MINIMAX_MODEL: "minimax-model.txt",
	MINIMAX_BASE_URL: "minimax-base-url.txt",
};

/**
 * Try to get from Infisical provider
 */
function getFromProvider(key: string): string | undefined {
	try {
		if (!isConfigured()) {
			return undefined;
		}

		const provider = getSecretProvider();
		if (!provider.isReady()) {
			return undefined;
		}

		return provider.get(key);
	} catch {
		return undefined;
	}
}

/**
 * Load a single key with precedence: Infisical > Environment > File
 */
function loadKey(key: string, filename: string): string | undefined {
	// 1. Check if already in environment
	if (process.env[key]) {
		return process.env[key];
	}

	// 2. Check Infisical provider
	const providerValue = getFromProvider(key);
	if (providerValue) {
		return providerValue;
	}

	// 3. Fall back to file
	const filePath = join(KEYS_DIR, filename);
	if (existsSync(filePath)) {
		const value = readFileSync(filePath, "utf8").trim();
		if (value) {
			return value;
		}
	}

	return undefined;
}

/**
 * Load all keys into process.env
 * Only sets env vars that are not already set
 */
export function loadKeys(): void {
	if (!existsSync(KEYS_DIR)) {
		console.log(`[key-loader] Keys directory not found: ${KEYS_DIR}`);
	}

	let loadedCount = 0;
	let infisicalCount = 0;
	let fileCount = 0;

	for (const [envVar, filename] of Object.entries(KEY_FILE_MAP)) {
		// Skip if already set
		if (process.env[envVar]) {
			continue;
		}

		const value = loadKey(envVar, filename);
		if (value) {
			process.env[envVar] = value;
			loadedCount++;

			// Track source
			if (getFromProvider(envVar)) {
				infisicalCount++;
			} else {
				fileCount++;
			}
		}
	}

	if (loadedCount > 0) {
		const source = infisicalCount > 0 ? `Infisical(${infisicalCount})` : "";
		const sourceParts = [source, fileCount > 0 ? `Files(${fileCount})` : ""].filter(Boolean);
		console.log(`[key-loader] Loaded ${loadedCount} key(s): ${sourceParts.join(", ")}`);
	}
}

/**
 * Get a specific key by name
 */
export function getKey(keyName: string): string | undefined {
	const filename = KEY_FILE_MAP[keyName];
	if (!filename) {
		return undefined;
	}
	return loadKey(keyName, filename);
}

/**
 * Check if keys directory exists
 */
export function hasKeysDir(): boolean {
	return existsSync(KEYS_DIR);
}

/**
 * List available key files
 */
export function listKeyFiles(): string[] {
	if (!existsSync(KEYS_DIR)) {
		return [];
	}

	const { readdirSync } = require("node:fs");
	return readdirSync(KEYS_DIR).filter((f: string) => f.endsWith(".txt"));
}

export default loadKeys;

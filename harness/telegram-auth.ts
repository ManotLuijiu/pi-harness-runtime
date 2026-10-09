/**
 * Telegram Authorization Module
 *
 * Validates Telegram user access from multiple sources:
 * - Environment variable (TELEGRAM_ALLOWED_USERS)
 * - Key file (~/.pi-harness-runtime/keys/telegram-allowed-users.txt)
 * - Legacy chat ID file (~/.pi-harness-runtime/keys/telegram-chat-id.txt)
 * - Infisical (future)
 *
 * Priority: Environment > Key file > Legacy chat ID file
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEYS_DIR = join(homedir(), ".pi-harness-runtime", "keys");

/**
 * Parse comma-separated user IDs
 */
function parseUserIds(content: string): Set<number> {
	const ids = new Set<number>();
	const parts = content.split(",").map(s => s.trim()).filter(Boolean);

	for (const part of parts) {
		const num = parseInt(part, 10);
		if (!isNaN(num) && num > 0) {
			ids.add(num);
		}
	}

	return ids;
}

/**
 * Load allowed users from environment variable
 */
function loadFromEnv(): Set<number> | null {
	const envValue = process.env.TELEGRAM_ALLOWED_USERS;
	if (!envValue) return null;

	return parseUserIds(envValue);
}

/**
 * Load allowed users from key file
 */
function loadFromKeyFile(filename: string): Set<number> | null {
	const filePath = join(KEYS_DIR, filename);
	if (!existsSync(filePath)) return null;

	try {
		const content = readFileSync(filePath, "utf8").trim();
		if (!content) return null;
		return parseUserIds(content);
	} catch {
		return null;
	}
}

/**
 * Get allowed Telegram user IDs from all sources
 *
 * Priority:
 * 1. TELEGRAM_ALLOWED_USERS environment variable
 * 2. telegram-allowed-users.txt key file
 * 3. telegram-chat-id.txt (legacy, single user)
 */
export function getAllowedUserIds(): Set<number> {
	// 1. Check environment variable first (highest priority)
	const fromEnv = loadFromEnv();
	if (fromEnv && fromEnv.size > 0) {
		return fromEnv;
	}

	// 2. Check dedicated allowed users file
	const fromKeyFile = loadFromKeyFile("telegram-allowed-users.txt");
	if (fromKeyFile && fromKeyFile.size > 0) {
		return fromKeyFile;
	}

	// 3. Check legacy chat ID file (single user)
	const fromLegacy = loadFromKeyFile("telegram-chat-id.txt");
	if (fromLegacy && fromLegacy.size > 0) {
		return fromLegacy;
	}

	// No allowed users configured
	return new Set();
}

/**
 * Check if a Telegram user ID is authorized
 */
export function isAuthorizedUser(userId: number): boolean {
	const allowed = getAllowedUserIds();
	// If no allowlist is configured, deny by default (fail closed)
	if (allowed.size === 0) {
		return false;
	}
	return allowed.has(userId);
}

/**
 * Validate callback query sender
 * Returns true if authorized, false if unauthorized
 */
export function validateSender(senderId: number): {
	authorized: boolean;
	reason?: string;
} {
	if (isAuthorizedUser(senderId)) {
		return { authorized: true };
	}

	// Fail closed - deny unauthorized users
	return {
		authorized: false,
		reason: "unauthorized_user",
	};
}

/**
 * Get allowlist source for diagnostics
 */
export function getAllowlistSource(): string {
	if (process.env.TELEGRAM_ALLOWED_USERS) {
		return "environment";
	}

	const allowedPath = join(KEYS_DIR, "telegram-allowed-users.txt");
	if (existsSync(allowedPath)) {
		return "key_file:telegram-allowed-users.txt";
	}

	const legacyPath = join(KEYS_DIR, "telegram-chat-id.txt");
	if (existsSync(legacyPath)) {
		return "legacy:telegram-chat-id.txt";
	}

	return "none";
}

/**
 * Get count of allowed users (for diagnostics, not values)
 */
export function getAllowedUserCount(): number {
	return getAllowedUserIds().size;
}

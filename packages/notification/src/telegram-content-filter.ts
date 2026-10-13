/**
 * Telegram Content Filter — Jev-Powered Sensitive Content Detection
 *
 * Before sending to Telegram, this module analyzes content for sensitive
 * credentials that should NOT be transmitted.
 */

import type { NotificationPayload } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import { logWarn } from "./file-logger.js";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Get API key from key file
 */
function getKeyFromFile(keyName: string): string | undefined {
	const keyPath = join(homedir(), ".pi-harness-runtime", "keys", `${keyName}.txt`);
	if (existsSync(keyPath)) {
		try {
			return readFileSync(keyPath, "utf8").trim();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Jev judgment result for content filtering
 */
export type ContentJudgment = "SEND" | "BLOCK" | "UNKNOWN";

/**
 * Result of content filtering decision
 */
export interface FilterResult {
	/** Whether to send to Telegram */
	shouldSend: boolean;
	/** Jev's judgment */
	judgment: ContentJudgment;
	/** Reason for blocking (if blocked) */
	reason?: string;
	/** Confidence score (0-1) */
	confidence?: number;
}

/**
 * Extract text content from notification payload
 */
function extractContent(payload: NotificationPayload): string {
	const parts: string[] = [];

	if (payload.title) parts.push(payload.title);
	if (payload.message) parts.push(payload.message);

	if (payload.details) {
		for (const [_key, value] of Object.entries(payload.details)) {
			if (typeof value === "string" && value) {
				parts.push(value);
			}
		}
	}

	return parts.join("\n");
}

/**
 * Simple heuristic check for obvious credentials (fallback when Jev unavailable)
 */
function heuristicCheck(content: string): FilterResult {
	// Check for common credential patterns
	const sensitivePatterns = [
		/\d+:[-A-Za-z0-9_]{35,}/, // Telegram bot token
		/sk-[a-zA-Z0-9]{20,}/,    // OpenAI-style keys
		/(?:api[_-]?key|bearer|access[_-]?token|auth[_-]?token)[=:\s]+[A-Za-z0-9_-]{20,}/i,
		/Bearer\s+[a-zA-Z0-9_-]{20,}/i, // Bearer tokens
		/(?:secret|password|passwd|pwd|credential)[=:\s]+[^\s]{16,}/i,
		/-----BEGIN\s+(?:RSA|EC|OPENSSH|DSA)\s+PRIVATE\s+KEY-----/,
		/infisical[_-]?(?:client[_-])?(?:secret|id)/i,
	];

	// More specific patterns that are less likely to have false positives
	// Only match if the string looks like a key (has specific prefix patterns)
	const keyLikePatterns = [
		/(?:xox[pborsa]-[\d-]+(?:,[\d-]+)*)/, // Slack tokens
		/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/, // GitHub tokens
		/(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16,}/, // AWS access keys
		/(?:sq0csp| sq0t[a-z0-9-]{22,43})/, // Square keys
		/(?:sk_live_|pk_live_)[A-Za-z0-9]{24,}/, // Stripe keys
	];

	// Check specific key-like patterns first (low false positive)
	for (const pattern of keyLikePatterns) {
		if (pattern.test(content)) {
			return {
				shouldSend: false,
				judgment: "BLOCK",
				reason: "Sensitive credential pattern detected",
				confidence: 0.95,
			};
		}
	}

	// Then check general patterns (higher false positive risk)
	for (const pattern of sensitivePatterns) {
		if (pattern.test(content)) {
			let matchType = "api_key_or_secret";
			if (/\d+:[-A-Za-z0-9_]{35,}/.test(content)) {
				matchType = "telegram_bot_token";
			} else if (/sk-[a-zA-Z0-9]{20,}/.test(content)) {
				matchType = "openai_style_key";
			} else if (/-----BEGIN\s+(RSA|EC|OPENSSH|DSA)\s+PRIVATE\s+KEY-----/.test(content)) {
				matchType = "private_key";
			} else if (/infisical/i.test(content)) {
				matchType = "infisical_credential";
			}

			return {
				shouldSend: false,
				judgment: "BLOCK",
				reason: `Sensitive content detected: ${matchType}`,
				confidence: 0.95,
			};
		}
	}

	return {
		shouldSend: true,
		judgment: "SEND",
		confidence: 0.9,
	};
}

/**
 * Call Jev to analyze content for sensitive credentials
 */
async function callJev(content: string): Promise<FilterResult | null> {
	// Get API key from environment or key file
	const apiKey = process.env.TYPESAFE_API_KEY || getKeyFromFile("jev-api-key") || getKeyFromFile("typesafe-api-key");

	if (!apiKey) {
		return null; // Jev not available
	}

	try {
		const response = await fetch("https://api.typesafe.ai/v1/jev/decide", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				question:
					"Does this message contain any API keys, tokens, secrets, passwords, or other sensitive credentials that should NOT be sent to a third-party service like Telegram? Answer only YES or NO.",
				context: {
					message: content,
					action: "telegram_notification",
					security_level: "high",
				},
			}),
		});

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as {
			decision?: string;
			confidence?: number;
			reasoning?: string;
		};

		const decision = data.decision?.toUpperCase() ?? "UNKNOWN";
		const isSensitive = decision === "YES" || decision === "BLOCK";

		return {
			shouldSend: !isSensitive,
			judgment: isSensitive ? "BLOCK" : "SEND",
			reason: data.reasoning,
			confidence: data.confidence,
		};
	} catch {
		return null;
	}
}

/**
 * Filter notification content before sending to Telegram
 *
 * @param payload - The notification payload
 * @returns Filter result with decision
 */
export async function filterTelegramContent(
	payload: NotificationPayload,
): Promise<FilterResult> {
	const content = extractContent(payload);

	// First, run heuristic check (always available)
	const heuristicResult = heuristicCheck(content);
	if (heuristicResult.judgment === "BLOCK") {
		logFilterDecision("BLOCK", heuristicResult.reason ?? "Heuristic match", payload.jobId);
		return heuristicResult;
	}

	// Try Jev if available
	const jevResult = await callJev(content);
	if (jevResult) {
		if (jevResult.judgment === "BLOCK") {
			logFilterDecision("BLOCK", jevResult.reason ?? "Jev judgment", payload.jobId);
		}
		return jevResult;
	}

	// Jev unavailable - use heuristic result
	return heuristicResult;
}

/**
 * Log filter decision securely (no content, just metadata)
 */
function logFilterDecision(
	decision: ContentJudgment,
	reason: string,
	jobId: string,
): void {
	logWarn(
		"[TelegramFilter]",
		`${decision} job=${jobId} reason=${reason} channel=telegram`,
	);
}

/**
 * Mask a value safely for logging
 */
function maskValue(value: string): string {
	if (!value || value.length <= 8) return "****";
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Get safe notification version (masked) for logging
 */
export function getSafeNotificationLog(payload: NotificationPayload): string {
	const maskedTitle = maskValue(payload.title);
	const maskedMessage = maskValue(payload.message);
	const maskedJobId = maskValue(payload.jobId);

	return `event=${payload.event} job=${maskedJobId} title=${maskedTitle} message_len=${maskedMessage.length}`;
}

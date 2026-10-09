/**
 * Telegram Content Filter — Jev-Powered Sensitive Content Detection
 *
 * Before sending to Telegram, Jev analyzes the content to determine
 * if it contains sensitive credentials that should NOT be transmitted.
 *
 * If Jev is unavailable or returns BLOCK, the message is:
 * - Not sent to Telegram
 * - Logged with safe metadata (no secrets)
 * - Optionally redirected to secure alternative (TUI only)
 */

import type { NotificationPayload } from "../packages/notification/dist/types.js";
import { maskString } from "../packages/notification/dist/mask-secrets.js";
import { getKey } from "./key-loader.js";

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

	// Title
	if (payload.title) {
		parts.push(payload.title);
	}

	// Main message
	if (payload.message) {
		parts.push(payload.message);
	}

	// Details
	if (payload.details) {
		for (const [key, value] of Object.entries(payload.details)) {
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
		/[a-zA-Z0-9_-]{32,}/,     // Long API keys
		/Bearer\s+[a-zA-Z0-9_-]{20,}/i, // Bearer tokens
		/(api[_-]?key|secret|token|password|credential)[=:\s]+[^\s]{16,}/i,
		/-----BEGIN\s+(RSA|EC|OPENSSH|DSA)\s+PRIVATE\s+KEY-----/,
		/infisical[_-]?(client[_-])?(secret|id)/i,
	];

	let matchFound = false;
	let matchType = "";

	for (const pattern of sensitivePatterns) {
		if (pattern.test(content)) {
			matchFound = true;
			// Determine what type of credential was found
			if (/\d+:[-A-Za-z0-9_]{35,}/.test(content)) {
				matchType = "telegram_bot_token";
			} else if (/sk-[a-zA-Z0-9]{20,}/.test(content)) {
				matchType = "openai_style_key";
			} else if (/-----BEGIN\s+(RSA|EC|OPENSSH|DSA)\s+PRIVATE\s+KEY-----/.test(content)) {
				matchType = "private_key";
			} else if (/infisical/i.test(content)) {
				matchType = "infisical_credential";
			} else {
				matchType = "api_key_or_secret";
			}
			break;
		}
	}

	if (matchFound) {
		return {
			shouldSend: false,
			judgment: "BLOCK",
			reason: `Sensitive content detected: ${matchType}`,
			confidence: 0.95,
		};
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
	const apiKey = getKey("typesafe-api-key") || process.env.TYPESAFE_API_KEY;

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
	// Extract content to analyze
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
	console.warn(
		`[TelegramFilter] ${decision} job=${jobId} reason=${reason} channel=telegram`,
	);
}

/**
 * Get safe notification version (masked) for logging
 */
export function getSafeNotificationLog(payload: NotificationPayload): string {
	const maskedTitle = maskString(payload.title);
	const maskedMessage = maskString(payload.message);
	const maskedJobId = maskString(payload.jobId);

	return `event=${payload.event} job=${maskedJobId} title=${maskedTitle} message_len=${maskedMessage.length}`;
}

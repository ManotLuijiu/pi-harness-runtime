/**
 * Planner Logger - Logs LangChain planner decisions
 *
 * Logs planner output:
 * - Provider selection (minimax vs gpt)
 * - User input decisions
 * - Escalation triggers
 * - Reasoning
 *
 * NOTE: This logs the LangChain planner's output, not TypeSafe Jev service calls.
 * The TypeSafe Jev service is tracked separately in the auto-continue system.
 */

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface PlannerDecision {
	timestamp: string;
	request: string;
	provider: "minimax" | "gpt";
	reason: string;
	userInput: {
		type: "yesNo" | "open" | null;
		question?: string;
	} | null;
	escalate: boolean;
	escalateReason?: string;
}

export interface PlannerLogEntry extends PlannerDecision {
	raw?: string; // Raw planner output for debugging
}

const LOG_DIR = join(homedir(), ".pi-harness-runtime", "logs");
const LOG_FILE = join(LOG_DIR, "planner.log");

// Telegram config (loaded from environment)
let TELEGRAM_BOT_TOKEN: string | undefined;
let TELEGRAM_CHAT_ID: string | undefined;
let telegramQueue: string[] = [];
let telegramSending = false;

export function configureTelegram(botToken?: string, chatId?: string): void {
	TELEGRAM_BOT_TOKEN = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
	TELEGRAM_CHAT_ID = chatId ?? process.env.TELEGRAM_CHAT_ID;
}

function ensureLogDir(): void {
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}
}

/**
 * Format decision for file log (detailed, multi-line)
 */
function formatFileLog(entry: PlannerLogEntry): string {
	const lines = [
		`═══════════════════════════════════════════════════════════════`,
		`[PLANNER] ${entry.timestamp}`,
		`═══════════════════════════════════════════════════════════════`,
		``,
		`## Request`,
		`${entry.request}`,
		``,
		`## Provider Decision`,
		`Provider: ${entry.provider.toUpperCase()}`,
		`Reason:   ${entry.reason}`,
		``,
		`## User Input Decision`,
		`Type:     ${entry.userInput?.type ?? "none (proceed automatically)"}`,
		entry.userInput?.question ? `Question: ${entry.userInput.question}` : ``,
		``,
		`## Escalation`,
		`Escalate: ${entry.escalate ? "YES → Switching to GPT" : "No"}`,
		entry.escalateReason ? `Reason:   ${entry.escalateReason}` : ``,
		``,
	];

	if (entry.raw) {
		lines.push(`## Raw Planner Output`);
		lines.push(`\`\`\`\n${entry.raw.slice(0, 500)}\n...\`\`\``); // Truncate for file
		lines.push(``);
	}

	lines.push(`═══════════════════════════════════════════════════════════════`);
	lines.push(``);

	return lines.join("\n");
}

/**
 * Format decision for Telegram (compact, single message)
 */
function formatTelegramMessage(entry: PlannerLogEntry): string {
	const providerIcon = entry.provider === "gpt" ? "🤖" : "⚡";
	const escalateIcon = entry.escalate ? " ↑ ESCALATE" : "";

	const parts = [
		`${providerIcon} *PLANNER DECISION*`,
		`\n*Provider:* ${entry.provider.toUpperCase()}${escalateIcon}`,
		`\n*Reason:* ${entry.reason}`,
	];

	if (entry.userInput?.question) {
		const inputIcon = entry.userInput.type === "yesNo" ? "❓" : "💬";
		parts.push(`\n${inputIcon} *USER INPUT:* ${entry.userInput.question}`);
	}

	// Truncate request for Telegram (usually too long)
	const shortRequest = entry.request.length > 100
		? entry.request.slice(0, 100) + "..."
		: entry.request;
	parts.push(`\n\n📋 *Request:* ${shortRequest}`);

	return parts.join("");
}

/**
 * Send message to Telegram (async, queued)
 */
async function sendToTelegram(message: string): Promise<void> {
	// Always try to load from env first
	TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? TELEGRAM_BOT_TOKEN;
	TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? TELEGRAM_CHAT_ID;

	if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
		console.log("[PLANNER] Telegram not configured - skipping");
		return;
	}

	console.log(`[PLANNER] Telegram sending: ${TELEGRAM_BOT_TOKEN?.slice(0, 10)}... to ${TELEGRAM_CHAT_ID}`);
	telegramQueue.push(message);

	// Process queue sequentially
	if (telegramSending) {
		console.log("[PLANNER] Telegram already sending, queued");
		return;
	}
	telegramSending = true;

	while (telegramQueue.length > 0) {
		const msg = telegramQueue.shift()!;
		try {
			const response = await fetch(
				`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: TELEGRAM_CHAT_ID,
						text: msg,
						parse_mode: "Markdown",
					}),
				},
			);

			if (!response.ok) {
				console.error(`[PLANNER] Telegram send failed: ${response.status}`);
			} else {
				console.log("[PLANNER] Telegram sent successfully");
			}
		} catch (err) {
			console.error(`[PLANNER] Telegram error:`, err);
		}
		// Rate limit: 1 message per second
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	telegramSending = false;
}

export async function logPlannerDecision(decision: PlannerLogEntry): Promise<void> {
	ensureLogDir();

	// Always log to file (sync)
	const fileLog = formatFileLog(decision);
	appendFileSync(LOG_FILE, fileLog);
	console.log(fileLog);

	// Send to Telegram (async, non-blocking for main flow)
	const telegramMsg = formatTelegramMessage(decision);
	// Fire-and-forget: don't await, let it run in background
	sendToTelegram(telegramMsg).catch((err) => {
		console.error("[PLANNER] Failed to send Telegram notification:", err);
	});
	// Also await briefly for testing, then let process exit handle it
	await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Parse planner's decision from output
 * Looks for [JEVO] and [USER_INPUT] markers
 */
export function parsePlannerDecision(planOutput: string): {
	provider: "minimax" | "gpt";
	reason: string;
	userInput: PlannerDecision["userInput"];
} {
	const result: {
		provider: "minimax" | "gpt";
		reason: string;
		userInput: PlannerDecision["userInput"];
	} = {
		provider: "minimax",
		reason: "default (no explicit decision)",
		userInput: null,
	};

	// Parse [JEVO] block
	const jevoMatch = planOutput.match(/\[JEVO\]\s*\{[\s\S]*?"provider":\s*"(minimax|gpt)"[\s\S]*?"reason":\s*"([^"]*)"[\s\S]*?\}/);
	if (jevoMatch) {
		result.provider = jevoMatch[1] as "minimax" | "gpt";
		result.reason = jevoMatch[2] || "explicit provider decision";
	}

	// Also check for [use-gpt] directive in the raw text
	if (/\[use-gpt(?:-only)?\]/i.test(planOutput)) {
		result.provider = "gpt";
		result.reason = "user directive: [use-gpt]";
	}

	// Parse [USER_INPUT] block
	const userInputMatch = planOutput.match(
		/\[USER_INPUT\]\s*(\{[\s\S]*?\})/,
	);
	if (userInputMatch) {
		try {
			const parsed = JSON.parse(userInputMatch[1]);
			if (parsed.type === "yesNo" || parsed.type === "open") {
				result.userInput = {
					type: parsed.type,
					question: parsed.question,
				};
			}
		} catch {
			// Ignore parse errors
		}
	}

	return result;
}

/**
 * Check if review indicates escalation needed
 */
export function shouldEscalate(reviewComments: string[]): {
	should: boolean;
	reason: string;
} {
	const escalationKeywords = [
		"blocked",
		"stuck",
		"cannot proceed",
		"complex",
		"race condition",
		"security issue",
		"architecture decision needed",
	];

	for (const comment of reviewComments) {
		const lowerComment = comment.toLowerCase();
		for (const keyword of escalationKeywords) {
			if (lowerComment.includes(keyword)) {
				return {
					should: true,
					reason: `Review flagged: "${keyword}"`,
				};
			}
		}
	}

	return { should: false, reason: "" };
}

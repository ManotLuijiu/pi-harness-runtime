#!/usr/bin/env bun
/**
 * Codex Watcher + Telegram E2E Test
 *
 * Tests the complete Codex session → Telegram pipeline:
 *   1. Session discovery (index + file system)
 *   2. Rollout parsing (visible assistant + user messages)
 *   3. Summary formatting (skips Jev noise, shows real content)
 *   4. Telegram send (ping + optional session summary)
 *
 * Key insight: session_index.jsonl only tracks ~22 recent sessions.
 * Large sessions (>20MB) are often NOT in the index (aged out).
 * This test finds the MOST ACTIVE session by file SIZE, not just recency.
 *
 * Usage:
 *   bun run e2e/codex-watcher-telegram.test.ts
 *
 * Send real Telegram messages:
 *   TEST_TELEGRAM_SEND=true bun run e2e/codex-watcher-telegram.test.ts
 *
 * Keys required:
 *   ~/.pi-harness-runtime/keys/telegram-bot-token.txt
 *   ~/.pi-harness-runtime/keys/telegram-chat-id.txt
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CODEX_DIR = join(homedir(), ".codex");
const CODEX_SESSIONS = join(CODEX_DIR, "sessions");
const CODEX_INDEX = join(CODEX_DIR, "session_index.jsonl");

// ---------------------------------------------------------------------------
// Telegram Helpers
// ---------------------------------------------------------------------------

function getTelegramKeys(): { botToken: string; chatId: string } | null {
	const envBotToken = process.env.TEST_TELEGRAM_BOT_TOKEN;
	const envChatId = process.env.TEST_TELEGRAM_CHAT_ID;
	if (envBotToken && envChatId) return { botToken: envBotToken, chatId: envChatId };

	const keysDir = join(homedir(), ".pi-harness-runtime", "keys");
	const botPath = join(keysDir, "telegram-bot-token.txt");
	const chatPath = join(keysDir, "telegram-chat-id.txt");

	if (!existsSync(botPath) || !existsSync(chatPath)) return null;

	try {
		const botToken = readFileSync(botPath, "utf-8").trim();
		const chatId = readFileSync(chatPath, "utf-8").trim();
		return botToken && chatId ? { botToken, chatId } : null;
	} catch {
		return null;
	}
}

async function sendTelegram(
	botToken: string,
	chatId: string,
	text: string,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await fetch(
			`https://api.telegram.org/bot${botToken}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text,
					parse_mode: "Markdown",
					disable_web_page_preview: true,
				}),
			},
		);

		if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// ---------------------------------------------------------------------------
// Codex Types
// ---------------------------------------------------------------------------

interface CodexSession {
	id: string;
	threadName: string;
	updatedAt: string;
	rolloutPath: string;
	sizeBytes: number;
}

interface CodexMessage {
	ordinal: number;
	timestamp: string;
	role: "assistant" | "user";
	text: string;
}

// ---------------------------------------------------------------------------
// Session Discovery
//
// session_index.jsonl only has ~22 recent sessions.
// Large sessions (many MB) are often NOT in the index.
// We find the most active session by file SIZE to catch real work.
// ---------------------------------------------------------------------------

function getAllSessions(): CodexSession[] {
	const sessions: CodexSession[] = [];

	// 1. Load session_index.jsonl for name + recency info
	const indexMap = new Map<string, { name: string; updatedAt: string }>();
	if (existsSync(CODEX_INDEX)) {
		for (const line of readFileSync(CODEX_INDEX, "utf-8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as Record<string, unknown>;
				if (typeof obj.id === "string" && typeof obj.thread_name === "string") {
					indexMap.set(obj.id as string, {
						name: obj.thread_name as string,
						updatedAt: String(obj.updated_at ?? ""),
					});
				}
			} catch {
				// skip
			}
		}
	}

	// 2. Walk sessions directory to find all rollout files + sizes
	const seenPaths = new Set<string>();

	function* walkDirs(dir: string): Generator<string> {
		try {
			const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				try {
					const stat = statSync(full);
					if (stat.isDirectory()) {
						yield full;
						yield* walkDirs(full);
					}
				} catch {
					// skip inaccessible
				}
			}
		} catch {
			// skip inaccessible
		}
	}

	for (const dirPath of walkDirs(CODEX_SESSIONS)) {
		try {
			const { readdirSync } = require("node:fs") as typeof import("node:fs");
			for (const file of readdirSync(dirPath)) {
				if (!file.startsWith("rollout-") || !file.endsWith(".jsonl")) continue;
				const fullPath = join(dirPath, file);
				if (seenPaths.has(fullPath)) continue;
				seenPaths.add(fullPath);

				// Extract session ID from filename
				// Format: rollout-YYYY-MM-DDTHH-MM-SS-<sessionId>.jsonl
				// parts[0]="rollout", parts[1..10]=date/time, rest=sessionId
				const base = file.replace(".jsonl", "");
				const parts = base.split("-");
				// Date parts: YYYY, MM, DD, "T", HH, MM, SS = 7 parts, then T/Z separator, then UUID
				// The session ID starts after the 7 date segments + separator
				// But T and Z are parts too, so: rollout(0), YYYY(1), MM(2), DD(3), T(4), HH(5), MM(6), SS(7), separator part(8), UUID-start(9...)
				// Actually the format is: rollout-YYYY-MM-DDTHH-MM-SS-<UUID>.jsonl
				// So after "rollout", we have 6 date parts + T separator = 7 non-UUID parts, then UUID
				// rollout-2026-09-29T13-35-36-01a0ebe0-...jsonl
				// Index: 0=rollout, 1=2026, 2=09, 3=29, 4=T13, 5=35, 6=36, 7=01a0ebe0... = session ID starts at 7
				const sessionId = parts.slice(7).join("-");
				const { size } = require("node:fs").statSync(fullPath) as { size: number };

				const indexInfo = indexMap.get(sessionId);
				sessions.push({
					id: sessionId,
					threadName: indexInfo?.name ?? "Unknown",
					updatedAt: indexInfo?.updatedAt ?? new Date(0).toISOString(),
					rolloutPath: fullPath,
					sizeBytes: size,
				});
			}
		} catch {
			// skip inaccessible
		}
	}

	// Sort by size descending — largest = most active work
	sessions.sort((a, b) => b.sizeBytes - a.sizeBytes);
	return sessions;
}

// ---------------------------------------------------------------------------
// Rollout Parser
// ---------------------------------------------------------------------------

function parseRollout(rolloutPath: string): CodexMessage[] {
	const messages: CodexMessage[] = [];

	try {
		const content = readFileSync(rolloutPath, "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as {
					type: string;
					ordinal?: number;
					timestamp?: string;
					payload?: unknown;
				};

				const ordinal = obj.ordinal ?? 0;
				const timestamp = obj.timestamp ?? "";

				if (obj.type === "event_msg") {
					const p = obj.payload as {
						type?: string;
						item?: {
							type?: string;
							content?: Array<{ type?: string; text?: string }>;
						};
					};
					if (p?.type === "item_completed" && p.item?.type === "AgentMessage") {
						const texts: string[] = [];
						for (const c of p.item.content ?? []) {
							if (c?.type === "Text" && c?.text) texts.push(c.text);
						}
						if (texts.length > 0) {
							messages.push({
								ordinal,
								timestamp,
								role: "assistant",
								text: texts.join("\n"),
							});
						}
					}
				} else if (obj.type === "response_item") {
					const p = obj.payload as {
						type?: string;
						role?: string;
						content?: Array<{ type?: string; text?: string }>;
					};
					if (p?.type === "message" && p?.role === "user") {
						const texts: string[] = [];
						for (const c of p.content ?? []) {
							if (c?.type === "input_text" && c?.text) texts.push(c.text);
						}
						if (texts.length > 0) {
							messages.push({
								ordinal,
								timestamp,
								role: "user",
								text: texts.join("\n"),
							});
						}
					}
				}
			} catch {
				// skip malformed
			}
		}
	} catch {
		// file not readable
	}

	messages.sort((a, b) => a.ordinal - b.ordinal);
	return messages;
}

// ---------------------------------------------------------------------------
// Summary Formatter
//
// Filters out Jev noise (short JSON risk assessments) and shows real content
// ---------------------------------------------------------------------------

function isJevNoise(text: string): boolean {
	// Short JSON-only messages are Jev risk assessment responses
	if (text.length < 200 && text.trim().startsWith("{")) {
		try {
			const obj = JSON.parse(text.trim());
			if (obj.risk_level !== undefined && obj.outcome !== undefined) return true;
		} catch {
			// not JSON, keep it
		}
	}
	return false;
}

function formatSessionSummary(
	session: CodexSession,
	messages: CodexMessage[],
): string {
	const assistantMsgs = messages.filter(
		(m) => m.role === "assistant" && !isJevNoise(m.text),
	);
	const userMsgs = messages.filter((m) => m.role === "user");

	// Show the last 3 non-Jev assistant messages
	const lastMsgs = assistantMsgs.slice(-3);

	const lines: string[] = [];
	lines.push(`*Codex Session: ${session.threadName}*`);
	lines.push(
		`Session ID: ${session.id.slice(0, 16)}...   Size: ${(session.sizeBytes / 1_000_000).toFixed(1)} MB`,
	);
	const updated = session.updatedAt && session.updatedAt !== new Date(0).toISOString()
		? new Date(session.updatedAt).toLocaleString()
		: "unknown";
	lines.push(`Updated: ${updated}`);
	lines.push(
		`Messages: ${assistantMsgs.length} assistant / ${userMsgs.length} user (${messages.length} total)`,
	);
	lines.push("");

	if (lastMsgs.length === 0) {
		lines.push("No visible assistant messages.");
	} else {
		lines.push("*Last 3 assistant messages:*");
		for (const msg of lastMsgs) {
			const preview = msg.text.slice(0, 350).replace(/\n+/g, " | ");
			lines.push(`  [${msg.ordinal}] ${preview}...`);
		}
	}

	// Truncate to 4000 chars
	let text = lines.join("\n");
	if (text.length > 4000) text = text.slice(0, 3997) + "...";
	return text;
}

// ---------------------------------------------------------------------------
// Run Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function run(): Promise<void> {
	console.log("=".repeat(60));
	console.log("Codex Watcher + Telegram E2E Test");
	console.log("=".repeat(60));
	console.log("");

	// --- Test 1: Discover all sessions ---
	console.log("[1] Session discovery...");
	const sessions = getAllSessions();
	console.log(`    Found ${sessions.length} sessions total`);
	if (sessions.length === 0) {
		console.error("    FAIL: No sessions found");
		failed++;
	} else {
		console.log(`    PASS: ${sessions.length} sessions found`);
		passed++;
	}

	// Show top 3 by size
	console.log("");
	console.log("    Top 3 sessions by file size:");
	for (let i = 0; i < Math.min(3, sessions.length); i++) {
		const s = sessions[i];
		const sizeMb = (s.sizeBytes / 1_000_000).toFixed(1);
		const marker = i === 0 ? " [MOST ACTIVE]" : "";
		console.log(
			`    ${i + 1}. ${sizeMb.padStart(6)} MB  ${s.threadName}${marker}`,
		);
	}

	// --- Test 2: Parse the most active session ---
	console.log("");
	console.log("[2] Parse most active session...");
	if (sessions.length === 0) {
		console.error("    SKIP: no sessions");
	} else {
		const top = sessions[0];
		console.log(`    Session: ${top.threadName}`);
		console.log(`    Path: ${top.rolloutPath}`);

		const messages = parseRollout(top.rolloutPath);
		const assistant = messages.filter(
			(m) => m.role === "assistant" && !isJevNoise(m.text),
		);
		const userCount = messages.filter((m) => m.role === "user").length;
		console.log(
			`    Messages: ${assistant.length} assistant (no-Jev) / ${userCount} user / ${messages.length} total`,
		);

		if (messages.length === 0) {
			console.error("    FAIL: No messages parsed");
			failed++;
		} else {
			console.log("    PASS: Session parsed successfully");
			passed++;
		}

		// --- Test 3: Format summary ---
		console.log("");
		console.log("[3] Format session summary...");
		const summary = formatSessionSummary(top, messages);
		console.log(`    Summary: ${summary.length} chars`);
		if (!summary.includes(top.threadName)) {
			console.error("    FAIL: Summary missing session name");
			failed++;
		} else {
			console.log("    PASS: Summary formatted");
			passed++;
			console.log("");
			console.log("    --- Summary Preview ---");
			for (const line of summary.split("\n").slice(0, 8)) {
				console.log(`    ${line}`);
			}
		}
	}

	// --- Test 4: Telegram keys ---
	console.log("");
	console.log("[4] Telegram keys check...");
	const keys = getTelegramKeys();
	if (!keys) {
		console.error(
			"    SKIP: No Telegram keys found.\n" +
				"    Create:\n" +
				"      ~/.pi-harness-runtime/keys/telegram-bot-token.txt\n" +
				"      ~/.pi-harness-runtime/keys/telegram-chat-id.txt",
		);
	} else {
		console.log("    PASS: Telegram configured");
		passed++;
	}

	// --- Test 5: Send Telegram ping ---
	console.log("");
	console.log("[5] Send ping to Telegram...");
	if (!keys) {
		console.log("    SKIP: No keys");
	} else {
		const ping = `*Codex Watcher E2E Ping*\npi-harness is healthy.\nTime: ${new Date().toISOString()}`;
		const result = await sendTelegram(keys.botToken, keys.chatId, ping);
		if (!result.ok) {
			console.error(`    FAIL: ${result.error}`);
			failed++;
		} else {
			console.log("    PASS: Ping sent");
			passed++;
		}
	}

	// --- Test 6: Send session summary to Telegram ---
	const doSend = process.env.TEST_TELEGRAM_SEND === "true" || process.env.TEST_TELEGRAM_SEND === "1";
	console.log("");
	console.log(`[6] Send session summary to Telegram (TEST_TELEGRAM_SEND=${doSend})...`);
	if (!keys) {
		console.log("    SKIP: No keys");
	} else if (!doSend) {
		console.log("    SKIP: Set TEST_TELEGRAM_SEND=true to enable");
	} else if (sessions.length === 0) {
		console.log("    SKIP: No sessions");
	} else {
		const top = sessions[0];
		const messages = parseRollout(top.rolloutPath);
		const summary = formatSessionSummary(top, messages);
		const result = await sendTelegram(keys.botToken, keys.chatId, summary);
		if (!result.ok) {
			console.error(`    FAIL: ${result.error}`);
			failed++;
		} else {
			console.log("    PASS: Summary sent to Telegram");
			passed++;
		}
	}

	// ---------------------------------------------------------------------------
	// Summary
	// ---------------------------------------------------------------------------
	console.log("");
	console.log("=".repeat(60));
	console.log(`Results: ${passed} passed, ${failed} failed`);
	console.log("=".repeat(60));

	if (failed > 0) process.exit(1);
}

run().catch((e) => {
	console.error("Unexpected error:", e);
	process.exit(1);
});

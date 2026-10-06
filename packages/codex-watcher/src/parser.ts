/**
 * Parser — extracts visible messages from Codex JSONL rollout lines.
 *
 * Safe subset (no developer/reasoning):
 *   type == "response_item" && payload.role == "user"  → input_text content
 *   type == "event_msg" && payload.type == "item_completed"
 *     && payload.item.type == "AgentMessage"
 *     && payload.item.content[].type == "Text"         → visible assistant text
 */

import type { CodexMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Raw event shapes (from Codex rollout JSONL)
// ---------------------------------------------------------------------------

interface RawEvent {
	ordinal: number;
	timestamp: string;
	type: string;
	payload: unknown;
}

interface AgentMessageContent {
	type: "Text";
	text: string;
}

interface AgentMessageItem {
	type: "AgentMessage";
	content: AgentMessageContent[];
}

interface EventMsgPayload {
	type: "item_completed";
	item: AgentMessageItem;
}

interface ResponseItemPayload {
	type: string;
	role?: string;
	content?: Array<{ type: string; text?: string }>;
	phase?: string;
}

interface RawEventMsg extends RawEvent {
	type: "event_msg";
	payload: EventMsgPayload;
}

interface RawResponseItem extends RawEvent {
	type: "response_item";
	payload: ResponseItemPayload;
}

// ---------------------------------------------------------------------------
// Parse a single JSONL line into a CodexMessage
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL line from a Codex rollout file.
 * Returns null if the line is not a visible message or is malformed.
 */
export function parseRolloutLine(line: string): CodexMessage | null {
	if (!line.trim()) return null;

	let raw: RawEvent;
	try {
		raw = JSON.parse(line) as RawEvent;
	} catch {
		return null;
	}

	// Assistant: visible text from AgentMessage item_completed events
	if (isEventMsg(raw)) {
		const msg = parseAssistantMessage(raw);
		if (msg) return msg;
	}

	// User: input_text from response_item events
	if (isResponseItem(raw)) {
		const msg = parseUserMessage(raw);
		if (msg) return msg;
	}

	return null;
}

/**
 * Parse all visible messages from a JSONL file.
 * Reads from a given byte offset so callers can do incremental reads.
 *
 * @param lines    Lines to parse (typically newly read lines)
 * @param latestOrdinal  The last ordinal already known (messages with ordinal ≤ this are skipped)
 * @returns Messages with ordinal > latestOrdinal
 */
export function parseNewMessages(
	lines: string[],
	latestOrdinal = 0,
): CodexMessage[] {
	const messages: CodexMessage[] = [];
	for (const line of lines) {
		const msg = parseRolloutLine(line);
		if (msg && msg.ordinal > latestOrdinal) {
			messages.push(msg);
		}
	}
	// Sort by ordinal (ascending) to preserve order
	messages.sort((a, b) => a.ordinal - b.ordinal);
	return messages;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isEventMsg(raw: RawEvent): raw is RawEventMsg {
	return raw.type === "event_msg";
}

function isResponseItem(raw: RawEvent): raw is RawResponseItem {
	return raw.type === "response_item";
}

// ---------------------------------------------------------------------------
// Parse specific message types
// ---------------------------------------------------------------------------

function parseAssistantMessage(raw: RawEventMsg): CodexMessage | null {
	const p = raw.payload as EventMsgPayload;
	if (p.type !== "item_completed") return null;
	if (p.item?.type !== "AgentMessage") return null;

	// Collect all Text content blocks
	const texts: string[] = [];
	for (const content of p.item.content ?? []) {
		if (content.type === "Text" && content.text) {
			texts.push(content.text);
		}
	}

	if (texts.length === 0) return null;

	return {
		ordinal: raw.ordinal,
		timestamp: raw.timestamp,
		role: "assistant",
		text: texts.join("\n"),
		isLatest: false,
	};
}

function parseUserMessage(raw: RawResponseItem): CodexMessage | null {
	const p = raw.payload;
	if (p.type !== "message") return null;
	if (p.role !== "user") return null;

	const texts: string[] = [];
	for (const content of p.content ?? []) {
		if (content.type === "input_text" && content.text) {
			texts.push(content.text);
		}
	}

	if (texts.length === 0) return null;

	return {
		ordinal: raw.ordinal,
		timestamp: raw.timestamp,
		role: "user",
		text: texts.join("\n"),
		isLatest: false,
	};
}

// ---------------------------------------------------------------------------
// Text extraction utilities
// ---------------------------------------------------------------------------

/**
 * Extract code blocks from assistant message text.
 * Useful for detecting "plan" vs "code" in the Codex output.
 */
export function extractCodeBlocks(text: string): string[] {
	const blocks: string[] = [];
	for (const match of text.matchAll(/```[\w]*\n?([\s\S]*?)```/g)) {
		blocks.push(match[1]?.trim() ?? "");
	}
	return blocks;
}

/**
 * Detect whether the message is a plan (markdown outline) vs code output.
 * Returns "plan" if it looks like a planning document, "code" if mostly code,
 * "mixed" if both, "unknown" otherwise.
 */
export function classifyMessage(
	text: string,
): "plan" | "code" | "mixed" | "unknown" {
	// Skip empty or very short messages
	if (!text || text.trim().length < 20) return "unknown";

	// Skip guardian review / risk assessment JSON responses
	// These have fields like "risk_level", "outcome", "user_authorization"
	if (/^\s*\{[^}]*"risk_level"[\s\S]*"outcome"[\s\S]*\}\.?\s*$/.test(text.trim())) {
		return "unknown";
	}

	// Skip pure JSON responses (generic check)
	if (/^\s*\{[^}]+\}\s*$/.test(text.trim()) && text.includes(":")) {
		const firstChar = text.trim()[0];
		if (firstChar === "{" || firstChar === "[") {
			return "unknown";
		}
	}

	// Skip messages that look like system status updates
	if (/^(Ready|Error|Failed|Processing|Thinking|In progress)/i.test(text.trim())) {
		return "unknown";
	}

	// Skip guardian/system prompts (not real user requests)
	if (/^The following is the (Codex )?agent history/i.test(text.trim()) ||
	    /^Codex agent history/i.test(text.trim()) ||
	    /^Additional context from (the )?agent/i.test(text.trim()) ||
	    /^Your task is to/i.test(text.trim()) ||
	    /^You are judging/i.test(text.trim())) {
		return "unknown";
	}

	// Check for markdown headings (strong indicator of planning)
	const headingCount = (text.match(/^#{1,3}\s+/gm) || []).length;
	const bulletCount = (text.match(/^[\s]*[-*+]\s+/gm) || []).length;
	const numberedCount = (text.match(/^[\s]*\d+\.\s+/gm) || []).length;

	const codeBlocks = extractCodeBlocks(text);
	const codeCharCount = codeBlocks.join("").replace(/\s/g, "").length;
	const nonCodeCharCount = text
		.replace(/```[\s\S]*?```/g, "")
		.replace(/\s/g, "").length;

	// If has headings/bullets and no/minimal code, likely a plan
	if ((headingCount >= 2 || bulletCount >= 3 || numberedCount >= 2) && codeCharCount < 100) {
		return "plan";
	}

	if (codeCharCount === 0 && nonCodeCharCount > 0) return "plan";
	if (nonCodeCharCount === 0 && codeCharCount > 0) return "code";
	if (codeCharCount > 0 && nonCodeCharCount > 0) return "mixed";
	return "unknown";
}

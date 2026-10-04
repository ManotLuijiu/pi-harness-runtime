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
/**
 * Parse a single JSONL line from a Codex rollout file.
 * Returns null if the line is not a visible message or is malformed.
 */
export declare function parseRolloutLine(line: string): CodexMessage | null;
/**
 * Parse all visible messages from a JSONL file.
 * Reads from a given byte offset so callers can do incremental reads.
 *
 * @param lines    Lines to parse (typically newly read lines)
 * @param latestOrdinal  The last ordinal already known (messages with ordinal ≤ this are skipped)
 * @returns Messages with ordinal > latestOrdinal
 */
export declare function parseNewMessages(lines: string[], latestOrdinal?: number): CodexMessage[];
/**
 * Extract code blocks from assistant message text.
 * Useful for detecting "plan" vs "code" in the Codex output.
 */
export declare function extractCodeBlocks(text: string): string[];
/**
 * Detect whether the message is a plan (markdown outline) vs code output.
 * Returns "plan" if it looks like a planning document, "code" if mostly code,
 * "mixed" if both, "unknown" otherwise.
 */
export declare function classifyMessage(text: string): "plan" | "code" | "mixed" | "unknown";
//# sourceMappingURL=parser.d.ts.map
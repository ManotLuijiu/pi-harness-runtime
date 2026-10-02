/**
 * Codex Session Watcher — types
 *
 * Watches ~/.codex/ for active Codex CLI sessions and parses visible
 * communication between the user and Codex (Planner role in PING-PONG).
 *
 * Key file locations:
 *   ~/.codex/session_index.jsonl          — session registry
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl  — session transcripts
 *
 * Visible message schema (safe subset — no developer/reasoning):
 *   type == "event_msg" && payload.type == "item_completed"
 *   && payload.item.type == "AgentMessage"
 *   && payload.item.content[].type == "Text"
 */

export interface CodexSession {
	/** Codex session ID (UUID) */
	id: string;
	/** Human-readable session name */
	threadName: string;
	/** ISO-8601 when session was last active */
	updatedAt: string;
	/** Absolute path to the rollout transcript file */
	rolloutPath: string;
}

export interface CodexMessage {
	/** Unique ordinal within the session (monotonically increasing) */
	ordinal: number;
	/** ISO-8601 timestamp */
	timestamp: string;
	/** Role: "user" (human) or "assistant" (Codex) */
	role: "user" | "assistant";
	/** Raw text content (markdown, code blocks, etc.) */
	text: string;
	/** Whether this message is the latest known message */
	isLatest: boolean;
}

export interface CodexEvent {
	/** Monotonically increasing ordinal within the session */
	ordinal: number;
	timestamp: string;
	/** Raw JSON payload from the JSONL line */
	raw: unknown;
}

export interface WatcherOptions {
	/** How often to poll session_index.jsonl and active rollout file (ms). Default: 2000 */
	pollIntervalMs?: number;
	/** Absolute path to Codex home. Default: ~/.codex */
	codexDir?: string;
	/** Called with new visible messages each poll cycle */
	onMessages?: (messages: CodexMessage[]) => void;
	/** Called when a new session becomes active */
	onSessionChange?: (session: CodexSession | null) => void;
	/** Stop watching after N polls with no new lines. Default: Infinity */
	maxIdlePolls?: number;
}

export interface WatcherHandle {
	stop: () => void;
	isRunning: () => boolean;
	latestSession: () => CodexSession | null;
	latestOrdinal: () => number;
}

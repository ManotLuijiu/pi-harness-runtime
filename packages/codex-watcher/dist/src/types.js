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
export {};
//# sourceMappingURL=types.js.map
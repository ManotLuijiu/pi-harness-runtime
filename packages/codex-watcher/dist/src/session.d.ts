/**
 * Session discovery — reads ~/.codex/session_index.jsonl to find active sessions.
 */
import type { CodexSession } from "./types.js";
/** Find the most recently active Codex session. */
export declare function getLatestSession(codexDir?: string): CodexSession | null;
/** Get all sessions sorted by most recent first. */
export declare function getAllSessions(codexDir?: string): CodexSession[];
//# sourceMappingURL=session.d.ts.map
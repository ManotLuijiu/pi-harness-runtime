/**
 * Codex Session Watcher — Main API
 *
 * Watches the active Codex CLI session and emits visible messages (user + assistant)
 * so the harness PING-PONG middleware can feed them to pi.dev.
 *
 * Usage:
 *   import { startWatcher, getLatestSession, getVisibleMessages } from "@pi-harness/codex-watcher";
 *
 *   // One-shot: get latest messages from the current session
 *   const session = getLatestSession();
 *   const messages = await getVisibleMessages(session.rolloutPath, { fromOrdinal: 0 });
 *
 *   // Continuous: poll the active session and emit messages
 *   const handle = startWatcher({
 *     onMessages: (msgs) => console.log(msgs),
 *   });
 *   // later: handle.stop();
 */
import { classifyMessage } from "./parser.js";
import { getAllSessions, getLatestSession } from "./session.js";
import type { CodexMessage, CodexSession, WatcherHandle, WatcherOptions } from "./types.js";
export type { CodexMessage, CodexSession, WatcherHandle, WatcherOptions };
export { classifyMessage, getAllSessions, getLatestSession };
/** Read all visible messages from a rollout file, starting from a given ordinal. */
export declare function getVisibleMessages(rolloutPath: string, options?: {
    fromOrdinal?: number;
    limit?: number;
}): Promise<CodexMessage[]>;
/**
 * Start watching the active Codex session and call `onMessages` whenever
 * new visible messages appear in the rollout file.
 *
 * @returns WatcherHandle — call handle.stop() to stop watching
 *
 * The watcher:
 * 1. Polls session_index.jsonl to detect active session changes
 * 2. Tracks file position so it only reads new lines (no re-read of full file)
 * 3. Calls onMessages with incremental messages each poll cycle
 */
export declare function startWatcher(options?: WatcherOptions): WatcherHandle;
//# sourceMappingURL=index.d.ts.map
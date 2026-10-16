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
import { existsSync, openSync, readFileSync, readSync, fstatSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { classifyMessage, parseNewMessages } from "./parser.js";
import { getAllSessions, getLatestSession } from "./session.js";
export { classifyMessage, detectReviewMarker, getAllSessions, getLatestSession };
import { detectReviewMarker } from "./parser.js";
// ---------------------------------------------------------------------------
// One-shot API
// ---------------------------------------------------------------------------
/** Read all visible messages from a rollout file, starting from a given ordinal. */
export async function getVisibleMessages(rolloutPath, options = {}) {
    const { fromOrdinal = 0, limit } = options;
    if (!existsSync(rolloutPath))
        return [];
    const content = readFileSync(rolloutPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    let messages = parseNewMessages(lines, fromOrdinal);
    if (limit)
        messages = messages.slice(-limit);
    if (messages.length > 0) {
        messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            isLatest: true,
        };
    }
    return messages;
}
// ---------------------------------------------------------------------------
// Streaming watcher API
// ---------------------------------------------------------------------------
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
 * 4. Preserves incomplete JSON lines until a complete newline-delimited record arrives
 */
export function startWatcher(options = {}) {
    const { pollIntervalMs = 2000, codexDir, onMessages, onSessionChange, } = options;
    const home = codexDir ?? join(homedir(), ".codex");
    let stopped = false;
    let currentFd = null;
    let currentPath = null;
    let currentOrdinal = 0;
    let currentBytePos = 0; // Track byte position we're at in the file
    let pendingBytes = null; // Raw bytes buffer for UTF-8 safety
    let pollCount = 0;
    const maxIdlePolls = options.maxIdlePolls ?? Infinity;
    // Track last known session to detect changes
    let lastSessionId = null;
    function stop() {
        stopped = true;
        if (currentFd !== null) {
            try {
                closeSync(currentFd);
            }
            catch {
                // ignore
            }
            currentFd = null;
        }
    }
    function isRunning() {
        return !stopped;
    }
    function latestSession() {
        return getLatestSession(home);
    }
    function latestOrdinal() {
        return currentOrdinal;
    }
    function openRollout(path) {
        if (currentFd !== null && currentPath !== path) {
            try {
                closeSync(currentFd);
            }
            catch {
                // ignore
            }
            currentFd = null;
        }
        // Open the file for reading
        currentFd = openSync(path, "r");
        currentPath = path;
        currentOrdinal = 0;
        currentBytePos = 0;
        pendingBytes = null; // Reset pending buffer for new file
        return currentFd;
    }
    /**
     * Read new lines from the file, preserving incomplete records.
     * Uses raw byte buffering to safely handle UTF-8 split across reads.
     * Returns complete lines only; incomplete trailing data is kept for next read.
     */
    function readNewLines(fd) {
        const stat = fstatSync(fd);
        const fileSize = stat.size;
        // Read from our tracked position to current end of file
        const bytesToRead = fileSize - currentBytePos;
        if (bytesToRead <= 0) {
            return { lines: [], newBytePos: currentBytePos };
        }
        const buf = Buffer.alloc(bytesToRead);
        const bytesRead = readSync(fd, buf, 0, buf.length, currentBytePos);
        // Buffer raw bytes for UTF-8 safety
        if (pendingBytes) {
            // Combine with previous incomplete buffer
            const combined = Buffer.concat([pendingBytes, buf.subarray(0, bytesRead)]);
            pendingBytes = combined;
        }
        else {
            pendingBytes = buf.subarray(0, bytesRead);
        }
        // Decode the complete buffer
        const text = pendingBytes.toString("utf8");
        // Split by newline to find complete records
        const lines = text.split("\n");
        // If buffer doesn't end with newline, last element is incomplete
        if (!pendingBytes.toString("utf8").endsWith("\n")) {
            // Keep the incomplete line for next read (already in pendingBytes)
            return { lines: [], newBytePos: currentBytePos };
        }
        // All lines are complete - emit them and clear buffer
        pendingBytes = null;
        // Filter out empty lines
        const completeLines = lines.filter((l) => l.trim());
        // Update our tracked position by bytes actually read
        const newBytePos = currentBytePos + bytesRead;
        return { lines: completeLines, newBytePos };
    }
    async function poll() {
        if (stopped)
            return;
        try {
            // Check for session change
            const session = getLatestSession(home);
            const sessionId = session?.id ?? null;
            if (sessionId !== lastSessionId) {
                // New session or session ended
                if (session) {
                    // Open new rollout
                    openRollout(session.rolloutPath);
                    currentOrdinal = 0;
                    // Read all existing lines as "historical"
                    const existing = await getVisibleMessages(session.rolloutPath, {
                        fromOrdinal: 0,
                    });
                    if (existing.length > 0) {
                        currentOrdinal = existing[existing.length - 1].ordinal;
                    }
                    onSessionChange?.(session);
                }
                else {
                    onSessionChange?.(null);
                }
                lastSessionId = sessionId;
                pollCount = 0;
            }
            if (!session || !currentFd || currentPath !== session.rolloutPath) {
                if (!stopped) {
                    await sleep(pollIntervalMs);
                    poll();
                }
                return;
            }
            // Read new lines from our tracked byte position
            const { lines, newBytePos } = readNewLines(currentFd);
            currentBytePos = newBytePos; // Update tracked position
            if (lines.length > 0) {
                pollCount = 0;
                const messages = parseNewMessages(lines, currentOrdinal);
                if (messages.length > 0) {
                    currentOrdinal = messages[messages.length - 1].ordinal;
                    messages[messages.length - 1] = {
                        ...messages[messages.length - 1],
                        isLatest: true,
                    };
                    onMessages?.(messages);
                }
            }
            else {
                pollCount++;
                if (pollCount > maxIdlePolls) {
                    stop();
                    return;
                }
            }
        }
        catch (_err) {
            // Session file may not exist yet; just wait
        }
        if (!stopped) {
            await sleep(pollIntervalMs);
            poll();
        }
    }
    // Start polling
    poll();
    return { stop, isRunning, latestSession, latestOrdinal };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=index.js.map
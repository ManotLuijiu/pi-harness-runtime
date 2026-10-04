/**
 * HerdrEventBus — File-based cross-process event bus for herdr tabs.
 *
 * Uses JSONL files in a shared workspace so separate pi processes
 * (coding agent, review agent, etc.) can communicate.
 *
 * Architecture:
 *   Workspace (shared dir)
 *   ├── events.jsonl          # Append-only event log
 *   ├── subscriptions/       # Per-agent subscription markers
 *   └── payloads/             # Event payload files
 *
 * Flow:
 *   1. Agent publishes event → append to events.jsonl + write payload
 *   2. Other agents poll events.jsonl → process matching events
 *   3. Each agent tracks last-read offset in subscriptions/{agentId}.json
 */
import { randomUUID } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from "fs";
import { join } from "path";
// ─── Config ──────────────────────────────────────────────────────────────
const DEFAULT_POLL_INTERVAL_MS = 2_000; // 2s poll
// Suppress stack traces — only show error message to keep TUI clean
const logError = (err) => console.error(`[herdr:bus] Error: ${err instanceof Error ? err.message : String(err)}`);
const MAX_EVENTS_PER_POLL = 50;
const PAYLOADS_DIR = "payloads";
const SUBSCRIPTIONS_DIR = "subscriptions";
// ─── HerdrEventBus ────────────────────────────────────────────────────
export class HerdrEventBus {
    workspace;
    agentId;
    pollIntervalMs;
    subscriptions = new Map();
    polling = false;
    pollTimer;
    constructor(config) {
        this.workspace = config.workspace;
        this.agentId = config.agentId;
        this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.ensureDirs();
    }
    // ─── Setup ────────────────────────────────────────────────────────
    ensureDirs() {
        const dirs = [
            this.workspace,
            join(this.workspace, PAYLOADS_DIR),
            join(this.workspace, SUBSCRIPTIONS_DIR),
        ];
        for (const dir of dirs) {
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
        }
    }
    // ─── Subscribe ────────────────────────────────────────────────────
    subscribe(topic, filter) {
        const id = randomUUID();
        this.subscriptions.set(id, {
            id,
            topic,
            lastOffset: 0,
            filter,
        });
        this.saveSubscriptions();
        return id;
    }
    unsubscribe(id) {
        this.subscriptions.delete(id);
        this.saveSubscriptions();
    }
    // ─── Publish ──────────────────────────────────────────────────────
    publish(topic, data) {
        const eventId = randomUUID();
        const payload = {
            topic,
            data,
            timestamp: new Date().toISOString(),
            eventId,
            source: this.agentId,
        };
        // Write payload file
        const payloadPath = join(this.workspace, PAYLOADS_DIR, `${eventId}.json`);
        writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
        // Append event reference to log
        const logLine = JSON.stringify({ eventId, topic, ts: payload.timestamp }) + "\n";
        appendFileSync(join(this.workspace, "events.jsonl"), logLine);
        return eventId;
    }
    // ─── Poll ────────────────────────────────────────────────────────
    startPolling(handler) {
        if (this.polling)
            return;
        this.polling = true;
        // Load last offsets from disk
        this.loadSubscriptions();
        this.pollTimer = setInterval(() => {
            this.pollEvents(handler).catch(logError);
        }, this.pollIntervalMs);
    }
    stopPolling() {
        this.polling = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    async pollEvents(handler) {
        const logPath = join(this.workspace, "events.jsonl");
        if (!existsSync(logPath))
            return;
        for (const [, sub] of this.subscriptions) {
            const events = this.readNewEvents(sub.lastOffset);
            let newOffset = sub.lastOffset;
            for (const event of events) {
                if (event.topic !== sub.topic)
                    continue;
                if (sub.filter && !sub.filter(event.data))
                    continue;
                // Load full payload
                const payloadPath = join(this.workspace, PAYLOADS_DIR, `${event.eventId}.json`);
                if (!existsSync(payloadPath))
                    continue;
                try {
                    const payload = JSON.parse(readFileSync(payloadPath, "utf-8"));
                    // Skip own events
                    if (payload.source === this.agentId)
                        continue;
                    await handler(payload);
                    newOffset = event._byteOffset;
                }
                catch {
                    // skip malformed payload
                }
            }
            // Update offset
            if (newOffset > sub.lastOffset) {
                sub.lastOffset = newOffset;
            }
        }
        this.saveSubscriptions();
    }
    readNewEvents(fromOffset) {
        const logPath = join(this.workspace, "events.jsonl");
        if (!existsSync(logPath))
            return [];
        const content = readFileSync(logPath, "utf-8");
        const lines = content
            .split("\n")
            .filter((line) => line.trim() !== "");
        const events = [];
        let offset = 0;
        for (const line of lines) {
            offset += line.length + 1; // +1 for newline
            if (offset <= fromOffset)
                continue;
            if (events.length >= MAX_EVENTS_PER_POLL)
                break;
            try {
                const parsed = JSON.parse(line);
                events.push(parsed);
            }
            catch {
                // skip malformed lines
            }
        }
        return events;
    }
    // ─── Persistence ─────────────────────────────────────────────────
    subscriptionsPath() {
        return join(this.workspace, SUBSCRIPTIONS_DIR, `${this.agentId}.json`);
    }
    saveSubscriptions() {
        const path = this.subscriptionsPath();
        const data = Object.fromEntries(this.subscriptions);
        writeFileSync(path, JSON.stringify(data, null, 2));
    }
    loadSubscriptions() {
        const path = this.subscriptionsPath();
        if (!existsSync(path))
            return;
        try {
            const data = JSON.parse(readFileSync(path, "utf-8"));
            for (const [id, sub] of Object.entries(data)) {
                this.subscriptions.set(id, sub);
            }
        }
        catch {
            // ignore
        }
    }
    // ─── Query ──────────────────────────────────────────────────────
    getSubscribedTopics() {
        return [...new Set([...this.subscriptions.values()].map((s) => s.topic))];
    }
    getWorkspace() {
        return this.workspace;
    }
}
// ─── Factory ────────────────────────────────────────────────────────────────
const HERDR_WORKSPACE = "/tmp/herdr-workspace";
export function getHerdrWorkspace() {
    if (!existsSync(HERDR_WORKSPACE)) {
        mkdirSync(HERDR_WORKSPACE, { recursive: true });
    }
    return HERDR_WORKSPACE;
}
export function createHerdrBus(agentId) {
    return new HerdrEventBus({
        workspace: getHerdrWorkspace(),
        agentId,
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    });
}
export function getHerdrWorkspacePaths() {
    const root = getHerdrWorkspace();
    return {
        root,
        code: join(root, "code"),
        reviews: join(root, "reviews"),
        payloads: join(root, "payloads"),
        subscriptions: join(root, "subscriptions"),
    };
}
export function ensureHerdrWorkspace() {
    const paths = getHerdrWorkspacePaths();
    const dirs = [
        paths.root,
        paths.code,
        paths.reviews,
        paths.payloads,
        paths.subscriptions,
    ];
    for (const dir of dirs) {
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
    }
    return paths;
}
// ─── Loop Event Publishers ────────────────────────────────────────────────────
export function publishLoopStarted(bus, config) {
    return bus.publish("loop.started", config);
}
export function publishCodeTick(bus, loopId, iteration, prompt) {
    return bus.publish("code.tick", {
        loopId,
        iteration,
        prompt,
    });
}
export function publishCodeWritten(bus, loopId, iteration, files, summary) {
    return bus.publish("code.written", {
        loopId,
        iteration,
        files,
        summary,
    });
}
export function publishReviewTick(bus, loopId, iteration, codeFiles) {
    return bus.publish("review.tick", {
        loopId,
        iteration,
        codeFiles,
    });
}
export function publishReviewCompleted(bus, loopId, iteration, verdict, message, reportFile) {
    return bus.publish("review.completed", {
        loopId,
        iteration,
        verdict,
        message,
        reportFile,
    });
}
export function publishLoopEarlyExit(bus, loopId, reason, message) {
    return bus.publish("loop.early_exit", {
        loopId,
        reason,
        message,
    });
}
export function publishLoopFinished(bus, loopId, summary, writes, reviews, finalVerdict) {
    return bus.publish("loop.finished", {
        loopId,
        summary,
        iterations: { writes, reviews, finalVerdict },
    });
}
// ─── Verdict Parser ──────────────────────────────────────────────────────────
const VERDICT_PATTERNS = [
    { pattern: /^##\s*Verdict:\s*APPROVED/im, verdict: "approved" },
    {
        pattern: /^##\s*Verdict:\s*CHANGES_REQUESTED/im,
        verdict: "changes_requested",
    },
    { pattern: /^##\s*Verdict:\s*CHANGES/i, verdict: "changes_requested" },
    { pattern: /^##\s*Verdict:\s*BLOCKED/im, verdict: "blocked" },
    { pattern: /^##\s*Verdict:\s*FAIL/im, verdict: "blocked" },
];
export function parseVerdict(content) {
    for (const { pattern, verdict } of VERDICT_PATTERNS) {
        if (pattern.test(content))
            return verdict;
    }
    return null;
}
export function parseVerdictMessage(content) {
    // Extract the paragraph after ## Verdict: X
    const match = content.match(/^##\s*Verdict:\s*\w+\s*\n+(.+?)(?=^##|\n+$)/ms);
    return match ? match[1].trim().slice(0, 500) : content.slice(0, 200);
}
// ─── Simple Convenience Publishers (non-loop) ──────────────────────────────
export function publishCodeWrittenSimple(bus, taskId, files, branch) {
    return bus.publish("code.written", {
        taskId,
        files,
        branch,
    });
}
export function publishReviewRequestedSimple(bus, taskId, codeTaskId) {
    return bus.publish("review.requested", { taskId, codeTaskId });
}
export function publishReviewCompletedSimple(bus, taskId, reportFile, status) {
    return bus.publish("review.completed", { taskId, reportFile, status });
}
//# sourceMappingURL=herdr-bus.js.map
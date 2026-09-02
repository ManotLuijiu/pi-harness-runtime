/**
 * Loop Daemon — Auto-triggered write-review loop.
 *
 * Design philosophy: Human *on* the loop, not *in* the loop.
 * The daemon starts itself, routes itself, and only notifies the human at gates
 * (approval, escalation, blocked). No human ever acts as the message bus between
 * GPT and MiniMax.
 *
 * Architecture:
 *
 *   TRIGGERS
 *   bd task created  ─┐
 *   inbox file       ─┤
 *   bus event        ─┼──► watcher (poll) ─► LeaseManager.claim ─► LangGraph.run
 *   cron (stub)     ─┘                     │
 *                                           │ publish (loop-events.ts) ─► HerdrEventBus
 *                                           │ gates ─► NotificationCenter
 *
 * Milestones:
 *   M1 — Daemon skeleton + inbox/bus watchers
 *   M2 — Runner integration: LeaseManager → buildWriteReviewLoop → publish
 *   M3 — Gates & notifications
 *   M4 — Robustness: surge/529 auto-resume + retry backoff, stale-lease, bd-tasks
 *          watcher (worker heartbeats: still TODO)
 *
 * Wiki: wiki/auto-trigger-multi-agent.md
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LeaseManager } from "../../packages/autonomous-runtime/src/lease.js";
import { ensureHerdrWorkspace, getHerdrWorkspace, } from "../../packages/event-bus/src/herdr-bus.js";
import { createHerdrBus, publishCodeWritten, publishLoopFinished, publishLoopStarted, publishReviewCompleted, } from "../../packages/event-bus/src/herdr-bus.js";
import { NotificationCenter } from "../../packages/notification/dist/notification-center.js";
import { invokeWithSurgeRetry } from "./surge.js";
import { StatusLineManager, isPiLensAvailable } from "./status-line.js";
import { createLoopCheckpointer } from "./checkpointer.js";
import { getTrajectoryStore, getApprovedPatternStore } from "../../packages/trajectory/src/index.js";
import { buildDryRunDeps, buildRealLoopDeps, buildWriteReviewLoop, } from "./graph.js";
// ─── Ack file helpers ───────────────────────────────────────────────────────
/** Path for human approval ack files. */
function ackFilePath(inboxDir, taskId) {
    return join(inboxDir, `ack-${taskId}.json`);
}
/** Read an ack file. Returns null if it doesn't exist yet. */
function readAck(inboxDir, taskId) {
    const path = ackFilePath(inboxDir, taskId);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
/** Write an ack file (used by tests / manual approval). */
export function writeAck(inboxDir, taskId, decision) {
    const path = ackFilePath(inboxDir, taskId);
    writeFileSync(path, JSON.stringify({ decision, decidedAt: new Date().toISOString() }, null, 2), "utf8");
}
// ─── Approval gate ───────────────────────────────────────────────────────────
/** Resolve the effective approval policy for a task given the daemon config. */
function effectivePolicy(task, config) {
    const policy = config.approvalPolicy ?? "never";
    if (policy === "on_class") {
        // Map ApprovalClass → gate policy
        const cls = task.approvalClass ?? "automatic_reversible";
        if (cls === "human_approval_required")
            return "on_blocked";
        return "never";
    }
    return policy;
}
/** Rejects after `ms` milliseconds — used to time-box task execution. */
function timeoutPromise(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms));
}
/** Wait (poll) for a human ack file or bus event. Returns true if approved. */
async function waitForAck(task, _config, _bus, inboxDir) {
    const pollMs = _config.pollMs ?? 2_000;
    const timeoutMs = 30 * 60 * 1_000; // 30-minute human SLA
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        // Check ack file first
        const ack = readAck(inboxDir, task.taskId);
        if (ack) {
            console.log(`[gate] Ack file found for ${task.taskId}: ${ack.decision}`);
            return ack.decision === "approved";
        }
        // Also accept approval.granted bus event
        // (The bus watcher is already polling; we just yield and let it tick)
        await sleep(pollMs);
    }
    console.warn(`[gate] Ack timeout for ${task.taskId} — treating as denied`);
    return false;
}
// ─── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function stableTaskId(source, raw) {
    if (source === "inbox") {
        // For inbox, use the filename as taskId so tests can write ack files
        return raw;
    }
    // Produce a stable short id for non-inbox sources
    const base = `${source}:${raw}`.slice(0, 64);
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
        const ch = base.charCodeAt(i);
        hash = (hash << 5) - hash + ch;
        hash |= 0;
    }
    return `task-${Math.abs(hash).toString(36)}-${Date.now().toString(36).slice(-6)}`;
}
// ─── Inbox watcher ──────────────────────────────────────────────────────────
/** Watch a directory for new `.md` files — each file = one TriggeredTask. */
class InboxWatcher {
    inboxDir;
    seen = new Map();
    pollMs;
    running = false;
    timer;
    constructor(inboxDir, pollMs) {
        this.inboxDir = inboxDir;
        this.pollMs = pollMs;
    }
    /** Start polling for new inbox files. */
    start(onTask) {
        this.running = true;
        // Seed seen set with existing files
        this._seedSeen();
        this._poll(onTask);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    _seedSeen() {
        if (!existsSync(this.inboxDir))
            return;
        for (const file of readdirSync(this.inboxDir)) {
            if (!file.endsWith(".md"))
                continue;
            if (file.startsWith("ack-"))
                continue;
            this.seen.set(file, {
                taskId: file,
                source: "inbox",
                seenAt: new Date().toISOString(),
            });
        }
    }
    _poll(onTask) {
        if (!this.running)
            return;
        try {
            if (existsSync(this.inboxDir)) {
                for (const file of readdirSync(this.inboxDir)) {
                    if (!file.endsWith(".md"))
                        continue;
                    if (file.startsWith("ack-"))
                        continue;
                    if (this.seen.has(file))
                        continue;
                    const taskId = stableTaskId("inbox", file);
                    const request = this._readRequest(file);
                    this.seen.set(file, {
                        taskId,
                        source: "inbox",
                        seenAt: new Date().toISOString(),
                    });
                    onTask({
                        taskId,
                        request,
                        source: "inbox",
                        triggeredAt: new Date().toISOString(),
                    });
                }
            }
        }
        catch (err) {
            console.error(`[inbox-watcher] poll error: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.timer = setTimeout(() => this._poll(onTask), this.pollMs);
    }
    _readRequest(file) {
        try {
            const content = readFileSync(join(this.inboxDir, file), "utf8");
            // Strip markdown frontmatter if present
            const stripped = content.replace(/^---[\s\S]*?---\n?/, "").trim();
            return stripped || file;
        }
        catch {
            return file;
        }
    }
}
// ─── Bus watcher ────────────────────────────────────────────────────────────
/** Watch HerdrEventBus for `task.proposed` events. */
class BusWatcher {
    bus;
    seen = new Set();
    pollMs;
    running = false;
    timer;
    constructor(bus, pollMs) {
        this.bus = bus;
        this.pollMs = pollMs;
    }
    /** Start polling for task.proposed bus events. */
    start(onTask) {
        this.running = true;
        this._poll(onTask);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    _poll(onTask) {
        if (!this.running)
            return;
        try {
            // Re-use the bus's own polling by manually reading events.jsonl
            // This avoids double-polling since we share the same workspace.
            // The bus watcher delegates to the bus's internal poll mechanism
            // by subscribing dynamically.
            this._pollBusEvents(onTask);
        }
        catch (err) {
            console.error(`[bus-watcher] poll error: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.timer = setTimeout(() => this._poll(onTask), this.pollMs);
    }
    _pollBusEvents(onTask) {
        // Read events.jsonl for task.proposed events we haven't seen
        const eventsPath = join(this.bus.getWorkspace(), "events.jsonl");
        if (!existsSync(eventsPath))
            return;
        try {
            const content = readFileSync(eventsPath, "utf8");
            const lines = content.split("\n").filter((l) => l.trim());
            for (const line of lines) {
                try {
                    const event = JSON.parse(line);
                    if (event.topic !== "task.proposed")
                        continue;
                    if (!event.eventId)
                        continue;
                    if (this.seen.has(event.eventId))
                        continue;
                    const payload = event.data;
                    if (!payload?.request)
                        continue;
                    this.seen.add(event.eventId);
                    const taskId = payload.taskId || stableTaskId("bus", payload.request);
                    onTask({
                        taskId,
                        request: payload.request,
                        source: "bus",
                        approvalClass: payload.approvalClass,
                        triggeredAt: new Date().toISOString(),
                    });
                }
                catch {
                    // skip malformed lines
                }
            }
        }
        catch {
            // File may not exist yet
        }
    }
}
// ─── Bd-tasks watcher ───────────────────────────────────────────────────────
/** Watch bd (beads) task list for new pending tasks. */
class BdTasksWatcher {
    pollMs;
    seen = new Set();
    running = false;
    timer;
    constructor(pollMs) {
        this.pollMs = pollMs;
    }
    start(onTask) {
        this.running = true;
        this._poll(onTask);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    async _poll(onTask) {
        if (!this.running)
            return;
        try {
            await this._checkBdTasks(onTask);
        }
        catch {
            // bd command not available — silently skip
        }
        this.timer = setTimeout(() => {
            this._poll(onTask).catch(() => { });
        }, this.pollMs);
    }
    async _checkBdTasks(onTask) {
        const { execSync } = await import("node:child_process");
        let output;
        try {
            output = execSync("bd list --status pending --json 2>/dev/null", {
                encoding: "utf8",
                timeout: 5_000,
            });
        }
        catch {
            return; // bd not available or no pending tasks
        }
        try {
            const result = JSON.parse(output);
            for (const task of result) {
                if (this.seen.has(task.id))
                    continue;
                this.seen.add(task.id);
                onTask({
                    taskId: task.id,
                    request: task.subject,
                    source: "bd-tasks",
                    approvalClass: task.metadata?.approvalClass,
                    triggeredAt: new Date().toISOString(),
                });
            }
        }
        catch {
            // bd output not valid JSON — ignore
        }
    }
}
// ─── Cron Source ──────────────────────────────────────────────────────────────
/**
 * Watches a cron-tasks directory and fires tasks on a configurable schedule.
 *
 * Storage layout:
 *   <workspace>/.cron-tasks/
 *   ├── every-5m/
 *   │   ├── task-1.json   {"request": "...", "enabled": true}
 *   │   └── task-2.json
 *   ├── hourly/
 *   │   └── task-3.json
 *   └── daily/
 *       └── task-4.json
 *
 * Schedule buckets: "every-5m", "every-10m", "every-30m", "hourly", "daily", "weekly"
 * Drop a JSON file into the right bucket to schedule a task.
 * Set "enabled": false to pause without deleting.
 */
class CronWatcher {
    workspace;
    scheduleMs;
    seen = new Map();
    timers = new Map();
    running = false;
    constructor(workspace) {
        this.workspace = workspace;
        this.scheduleMs = {
            "every-5m": 5 * 60_000,
            "every-10m": 10 * 60_000,
            "every-30m": 30 * 60_000,
            hourly: 3_600_000,
            daily: 86_400_000,
            weekly: 7 * 86_400_000,
        };
    }
    start(onTask) {
        this.running = true;
        const cronDir = `${this.workspace}/.cron-tasks`;
        import("node:fs").then(({ mkdirSync, existsSync }) => {
            if (!existsSync(cronDir))
                mkdirSync(cronDir, { recursive: true });
        });
        // Fire once at start
        this._tickAll(onTask);
        // Schedule each bucket
        for (const [schedule, ms] of Object.entries(this.scheduleMs)) {
            this._scheduleNext(schedule, ms, onTask);
        }
    }
    stop() {
        this.running = false;
        for (const t of this.timers.values())
            clearTimeout(t);
        this.timers.clear();
    }
    _scheduleNext(schedule, ms, onTask) {
        const timer = setTimeout(async () => {
            if (!this.running)
                return;
            await this._tickSchedule(schedule, onTask);
            this._scheduleNext(schedule, ms, onTask);
        }, ms);
        this.timers.set(schedule, timer);
    }
    async _tickAll(onTask) {
        for (const schedule of Object.keys(this.scheduleMs)) {
            await this._tickSchedule(schedule, onTask);
        }
    }
    async _tickSchedule(schedule, onTask) {
        if (!this.running)
            return;
        const { readdirSync, readFileSync, existsSync } = await import("node:fs");
        const cronDir = `${this.workspace}/.cron-tasks/${schedule}`;
        if (!existsSync(cronDir))
            return;
        let seen = this.seen.get(schedule);
        if (!seen) {
            seen = new Set();
            this.seen.set(schedule, seen);
        }
        let files;
        try {
            files = readdirSync(cronDir).filter((f) => f.endsWith(".json"));
        }
        catch {
            return;
        }
        for (const file of files) {
            if (seen.has(file))
                continue;
            seen.add(file);
            let taskData;
            try {
                taskData = JSON.parse(readFileSync(`${cronDir}/${file}`, "utf8"));
            }
            catch {
                continue;
            }
            if (taskData.enabled === false)
                continue;
            if (!taskData.request)
                continue;
            onTask({
                taskId: `cron:${schedule}:${file.replace(".json", "")}`,
                request: taskData.request,
                source: "cron",
                triggeredAt: new Date().toISOString(),
            });
        }
    }
}
// ─── Tunnel Health Monitor ───────────────────────────────────────────────────
/**
 * Monitors the health of a SSH tunnel (e.g. tailscale-tunnel.sh) and
 * auto-restarts it if the target port becomes unreachable.
 *
 * This prevents the daemon from freezing when the tunnel drops silently —
 * a common cause of tasks that appear to hang forever.
 */
class TunnelMonitor {
    scriptPath;
    checkIntervalMs;
    targetHost;
    targetPort;
    running = false;
    timer;
    consecutiveFailures = 0;
    maxConsecutiveFailures = 2;
    constructor(scriptPath, opts = {}) {
        this.scriptPath = scriptPath;
        this.checkIntervalMs = opts.checkIntervalMs ?? 30_000; // 30s default
        this.targetHost = opts.targetHost ?? "127.0.0.1";
        this.targetPort = opts.targetPort ?? 5433;
    }
    start() {
        this.running = true;
        console.log(`[tunnel-monitor] Starting — script=${this.scriptPath}, check every ${this.checkIntervalMs / 1000}s, target=${this.targetHost}:${this.targetPort}`);
        this._check();
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        console.log("[tunnel-monitor] Stopped.");
    }
    /**
     * Run a health check and restart if the port is down.
     * Returns true if the tunnel is healthy.
     */
    async checkAndFix() {
        const healthy = await this._isPortOpen();
        if (healthy) {
            this.consecutiveFailures = 0;
            return true;
        }
        this.consecutiveFailures++;
        console.warn(`[tunnel-monitor] Port ${this.targetHost}:${this.targetPort} unreachable (failure #${this.consecutiveFailures})`);
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            console.warn(`[tunnel-monitor] Tunnel appears down — restarting...`);
            await this._restartTunnel();
            this.consecutiveFailures = 0;
        }
        return false;
    }
    async _check() {
        if (!this.running)
            return;
        await this.checkAndFix();
        this.timer = setTimeout(() => this._check(), this.checkIntervalMs);
    }
    async _isPortOpen() {
        const { createConnection } = await import("node:net");
        return new Promise((resolve) => {
            const socket = createConnection({
                host: this.targetHost,
                port: this.targetPort,
                timeout: 2_000, // 2s timeout — just checking reachability
            });
            socket.on("connect", () => {
                socket.destroy();
                resolve(true);
            });
            socket.on("timeout", () => {
                socket.destroy();
                resolve(false);
            });
            socket.on("error", () => {
                resolve(false);
            });
        });
    }
    async _restartTunnel() {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        try {
            // Stop first
            await execAsync(`bash "${this.scriptPath}" stop 2>/dev/null`, {
                timeout: 10_000,
            }).catch(() => { }); // ignore errors on stop
            // Small delay before restart
            await new Promise((r) => setTimeout(r, 1_000));
            // Start
            const { stdout, stderr } = await execAsync(`bash "${this.scriptPath}" start 2>&1`, { timeout: 30_000 });
            console.log(`[tunnel-monitor] Restart output: ${stdout.trim() || stderr.trim() || "ok"}`);
        }
        catch (err) {
            console.error(`[tunnel-monitor] Restart failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
// ─── Loop Daemon ───────────────────────────────────────────────────────────
/**
 * The main daemon class. Coordinates watchers, leasing, loop execution, and
 * notifications.
 *
 * Usage:
 *   const daemon = new LoopDaemon({ dryRun: true, sources: ["inbox", "bus"] });
 *   daemon.start();
 *   // ... daemon runs in the background ...
 *   daemon.stop();
 */
export class LoopDaemon {
    config;
    agentId;
    leaseManager;
    bus;
    notificationCenter;
    inboxDir;
    inboxWatcher;
    busWatcher;
    bdWatcher;
    cronWatcher;
    tunnelMonitor;
    statusLine;
    widget;
    /** Currently running tasks (taskId → RunningTask) */
    running = new Map();
    stopped = false;
    constructor(config = {}) {
        ensureHerdrWorkspace();
        this.config = {
            agentId: config.agentId ?? "loop-daemon",
            pollMs: config.pollMs ?? 2_000,
            maxIterations: config.maxIterations ?? 3,
            approvalPolicy: config.approvalPolicy ?? "never",
            dryRun: config.dryRun ?? false,
            costCapUsd: config.costCapUsd ?? undefined,
            surgePolicy: config.surgePolicy,
            taskTimeoutMs: config.taskTimeoutMs,
            checkpointer: config.checkpointer,
            sources: config.sources ?? ["inbox", "bus"],
            workspace: config.workspace ?? getHerdrWorkspace(),
            notificationConfig: config.notificationConfig ?? undefined,
            tunnelCommand: config.tunnelCommand,
            widget: config.widget,
            deps: config.deps,
        };
        this.agentId = this.config.agentId;
        this.bus = createHerdrBus(this.agentId);
        // All watchers share the bus's workspace directory
        const workspace = this.bus.getWorkspace();
        this.inboxDir = workspace; // inbox IS the herdr workspace root
        this.leaseManager = new LeaseManager({
            leasesDir: `${this.inboxDir}/leases`,
        });
        this.leaseManager.ensureDir();
        if (this.config.notificationConfig) {
            this.notificationCenter = new NotificationCenter({
                channels: this._buildChannels(this.config.notificationConfig),
                enabled: true,
            });
        }
        else {
            this.notificationCenter = null;
        }
        this.inboxWatcher = new InboxWatcher(this.inboxDir, this.config.pollMs);
        this.widget = this.config.widget ?? null;
        this.busWatcher = new BusWatcher(this.bus, this.config.pollMs);
        this.bdWatcher = new BdTasksWatcher(this.config.pollMs);
        this.cronWatcher = this.config.sources.includes("cron")
            ? new CronWatcher(this.bus.getWorkspace())
            : null;
        this.statusLine = isPiLensAvailable()
            ? null
            : new StatusLineManager(this.bus.getWorkspace());
        // Tunnel monitor — only active when a tunnel script is configured
        if (this.config.tunnelCommand) {
            this.tunnelMonitor = new TunnelMonitor(this.config.tunnelCommand);
        }
        else {
            this.tunnelMonitor = null;
        }
        // Reap stale leases from previous runs
        const reclaimed = this.leaseManager.recoverOnStartup();
        if (reclaimed.length > 0) {
            console.log(`[daemon] Reclaimed ${reclaimed.length} stale lease(s): ${reclaimed.join(", ")}`);
        }
    }
    // ─── Public API ──────────────────────────────────────────────────────
    /** Start the daemon — begins watching all configured sources. */
    start() {
        console.log(`[daemon] Starting (agentId=${this.agentId}, sources=[${this.config.sources.join(", ")}], dryRun=${this.config.dryRun})`);
        this.stopped = false;
        if (this.config.sources.includes("inbox")) {
            console.log(`[daemon] Starting inbox watcher on ${this.inboxDir}`);
            this.inboxWatcher.start((t) => this._onTriggered(t));
        }
        if (this.config.sources.includes("bus")) {
            console.log(`[daemon] Starting bus watcher (task.proposed)`);
            this.busWatcher.start((t) => this._onTriggered(t));
        }
        if (this.config.sources.includes("bd-tasks")) {
            console.log(`[daemon] Starting bd-tasks watcher`);
            this.bdWatcher.start((t) => this._onTriggered(t));
        }
        this.tunnelMonitor?.start();
        this.statusLine?.start();
        console.log("[daemon] Started.");
    }
    /** Stop all watchers and release all held leases. */
    stop() {
        console.log("[daemon] Stopping...");
        this.stopped = true;
        this.inboxWatcher.stop();
        this.busWatcher.stop();
        this.bdWatcher.stop();
        this.cronWatcher?.stop();
        this.statusLine?.stop();
        this.tunnelMonitor?.stop();
        // Release all held leases
        for (const [taskId, _runningTask] of this.running) {
            try {
                this.leaseManager.release(taskId, this.agentId);
            }
            catch (err) {
                console.error(`[daemon] Failed to release lease for ${taskId}: ${err}`);
            }
        }
        this.running.clear();
        console.log("[daemon] Stopped.");
    }
    /** Returns true if stop() has been called. */
    get isStopped() {
        return this.stopped;
    }
    // ─── Task processing ──────────────────────────────────────────────────
    _onTriggered(task) {
        if (this.stopped)
            return;
        // Skip if already running this task
        if (this.running.has(task.taskId)) {
            console.log(`[daemon] Task ${task.taskId} already running — skipping trigger`);
            return;
        }
        console.log(`[daemon] Triggered: [${task.source}] ${task.taskId} — "${task.request.slice(0, 60)}"`);
        // Try to claim the lease
        const lease = this.leaseManager.claim(task.taskId, this.agentId);
        if (!lease) {
            console.log(`[daemon] Lease held for ${task.taskId} — skipping (another worker)`);
            return;
        }
        // Run the task asynchronously (do not block the watcher)
        this.running.set(task.taskId, {
            task,
            lease,
            startedAt: new Date().toISOString(),
        });
        this._runTask(task).catch((err) => {
            console.error(`[daemon] Task ${task.taskId} failed: ${err instanceof Error ? err.message : String(err)}`);
            this.running.delete(task.taskId);
        });
    }
    async _runTask(task) {
        const loopId = `loop-${randomUUID().slice(0, 8)}`;
        const log = (msg) => console.log(`[${loopId}] ${msg}`);
        try {
            // ── Tunnel health check — self-heal before running a task ───────────────
            if (this.tunnelMonitor) {
                const tunnelOk = await this.tunnelMonitor.checkAndFix();
                if (!tunnelOk) {
                    log("Tunnel health check failed — waiting for tunnel restart...");
                }
            }
            // ── Gate check (I7) ──────────────────────────────────────────────
            const policy = effectivePolicy(task, this.config);
            if (policy === "always" || policy === "on_blocked") {
                log(`Gate policy=${policy} — waiting for human approval before starting`);
                const approved = await waitForAck(task, this.config, this.bus, this.inboxDir);
                if (!approved) {
                    log(`Human denied approval — parking task`);
                    this._notifyHumanReviewNeeded(task, "Human denied approval for task start");
                    this._releaseLease(task.taskId);
                    this.running.delete(task.taskId);
                    return;
                }
                log(`Human approved — proceeding`);
            }
            // ── Build loop deps ───────────────────────────────────────────────
            const deps = this.config.deps ??
                (this.config.dryRun
                    ? buildDryRunDeps({
                        maxIterations: this.config.maxIterations,
                        blackboardDir: this.bus.getWorkspace(),
                    })
                    : await buildRealLoopDeps({
                        maxIterations: this.config.maxIterations,
                        blackboardDir: this.bus.getWorkspace(),
                    }));
            // Inject transition publishing into onStep (also drives the widget)
            const originalOnStep = deps.onStep;
            deps.onStep = (step, state) => {
                originalOnStep?.(step, state);
                this._publishTransition(loopId, step, state);
                this._updateWidget(step, state);
            };
            // ── Trajectory capture (M7a) ──────────────────────────────────────────
            const store = getTrajectoryStore();
            const trajId = store.start(task.request);
            const trajStartMs = Date.now();
            // ── Run the graph (surge-aware: 529/overloaded pauses auto-resume) ──
            log(`Starting write-review loop (maxIterations=${this.config.maxIterations})`);
            const checkpointer = (() => {
                if (this.config.checkpointer === false)
                    return false;
                if (this.config.checkpointer === true ||
                    typeof this.config.checkpointer === "string") {
                    return createLoopCheckpointer(this.config.checkpointer === true
                        ? this.bus.getWorkspace()
                        : this.config.checkpointer);
                }
                return undefined; // default MemorySaver
            })();
            const loop = buildWriteReviewLoop(deps, { checkpointer });
            const invokeTask = (signal) => invokeWithSurgeRetry(() => loop.invoke({ request: task.request }, { configurable: { thread_id: loopId }, signal }), {
                policy: this.config.surgePolicy,
                onSurge: ({ attempt, delayMs }) => log(`Provider surge (529) — resume in ${Math.round(delayMs / 1000)}s (attempt ${attempt})`),
                onExhausted: () => {
                    this._notifyHumanReviewNeeded(task, "Provider surged past max surge attempts — task failed");
                },
            });
            let finalState;
            if (this.config.taskTimeoutMs) {
                const ac = new AbortController();
                const timeout = setTimeout(() => {
                    log(`Task timed out after ${this.config.taskTimeoutMs}ms — aborting`);
                    ac.abort();
                }, this.config.taskTimeoutMs);
                try {
                    finalState = await Promise.race([
                        invokeTask(ac.signal),
                        timeoutPromise(this.config.taskTimeoutMs),
                    ]);
                }
                finally {
                    clearTimeout(timeout);
                }
            }
            else {
                finalState = await invokeTask();
            }
            const verdict = finalState.review?.verdict ?? "blocked";
            const iterations = finalState.iteration ?? 0;
            log(`Loop finished: ${verdict} after ${iterations} iteration(s)`);
            // ── Trajectory append (M7a) ───────────────────────────────────────────
            const rawComments = finalState.review?.comments ?? [];
            const comments = rawComments.map((c) => ({
                file: c.file ?? undefined,
                comment: c.comment,
                severity: (c.severity ?? "minor"),
            }));
            const files = [
                ...new Set(rawComments.map((c) => c.file).filter(Boolean)),
            ];
            const reason = verdict === "approved"
                ? "reviewer approved"
                : verdict === "blocked"
                    ? "reviewer blocked the task"
                    : iterations >= 3
                        ? `max iterations (${iterations}) reached with changes still requested`
                        : comments.length > 0 && comments.every((c) => c.severity === "minor")
                            ? `converged: only minor comments (${comments.length})`
                            : `stuck: ${files[0] ?? "unknown"} flagged for ${comments.length} comment(s)`;
            store.append({
                id: trajId,
                taskRequest: task.request,
                createdAt: new Date(trajStartMs).toISOString(),
                durationMs: Date.now() - trajStartMs,
                iterations,
                verdict: verdict,
                reason,
                plan: finalState.plan ?? "",
                code: finalState.code ?? "",
                files,
                comments,
                summary: finalState.review?.summary ?? "",
                classified: false,
            });
            // M7b: Record approved patterns so the reviewer learns from success
            if (verdict === "approved") {
                const approvedPatterns = getApprovedPatternStore();
                approvedPatterns.approve(comments);
                log(`[M7b] Recorded ${comments.length} approved pattern(s)`);
            }
            // Update widget on loop completion
            if (this.widget) {
                this.widget.setComplete(verdict === "approved"
                    ? "approved"
                    : verdict === "blocked"
                        ? "rejected"
                        : "max_iterations");
            }
            const loopDone = verdict === "approved"
                ? "[F] finished"
                : verdict === "blocked"
                    ? "[!] blocked"
                    : "[~] max_iter";
            this.statusLine?.updateLoopStatus(loopDone);
            // ── Gate check after blocked verdict ────────────────────────────────
            if (verdict === "blocked" &&
                effectivePolicy(task, this.config) === "on_blocked") {
                log(`Blocked verdict + on_blocked policy — waiting for human ack`);
                const approved = await waitForAck(task, this.config, this.bus, this.inboxDir);
                if (!approved) {
                    log(`Human denied — finalizing as blocked`);
                }
            }
            // ── Publish loop.finished ──────────────────────────────────────────
            publishLoopFinished(this.bus, loopId, `${iterations} iteration(s) — ${verdict}`, iterations, iterations, verdict);
            // ── Notify on blocked / max-iterations ─────────────────────────────
            if (verdict === "blocked") {
                this._notifyHumanReviewNeeded(task, `Loop blocked: ${finalState.review?.summary ?? "no details"}`);
            }
            else if (verdict === "changes_requested") {
                this._notifyHumanReviewNeeded(task, `${iterations} iteration(s) exhausted with changes still requested: ${finalState.review?.comments.map((c) => c.comment).join("; ") ?? "no details"}`);
            }
            else {
                // approved
                this._notifyReadyForClient(task);
            }
        }
        finally {
            this._releaseLease(task.taskId);
            this.running.delete(task.taskId);
        }
    }
    _publishTransition(loopId, step, state) {
        switch (step) {
            case "plan": {
                // Publish loop.started on the plan step
                publishLoopStarted(this.bus, {
                    loopId,
                    writeCount: 0,
                    reviewCount: 0,
                    prompt: state.request ?? "",
                    nextReviewAfter: 0,
                    createdAt: new Date().toISOString(),
                });
                break;
            }
            case "write":
                publishCodeWritten(this.bus, loopId, state.iteration, [], undefined);
                break;
            case "review":
                publishReviewCompleted(this.bus, loopId, state.iteration, state.review?.verdict ?? "blocked", state.review?.summary ?? "", this._reviewReportPath(loopId, state.iteration));
                break;
        }
    }
    /**
     * Drive the TUI widget through loop transitions.
     * Called from onStep within _runTask.
     */
    _updateWidget(step, state) {
        const w = this.widget;
        if (!w)
            return;
        switch (step) {
            case "plan": {
                w.setPhase("planning", "GPT planning");
                this.statusLine?.updateLoopStatus("[P] planning");
                break;
            }
            case "write": {
                w.setPhase("writing", "MiniMax coding");
                this.statusLine?.updateLoopStatus("[W] coding");
                // After a write step, bump the iteration counter
                w.startIteration(state.iteration, this.config.maxIterations);
                break;
            }
            case "review": {
                w.setPhase("reviewing", "GPT reviewing");
                this.statusLine?.updateLoopStatus("[R] reviewing");
                // Process review comments — one record per file
                const comments = state.review?.comments ?? [];
                if (comments.length === 0)
                    break;
                // Group blocking comments by file (severity: "critical" = blocking)
                const byFile = new Map();
                for (const c of comments) {
                    if (c.severity === "critical") {
                        const prev = byFile.get(c.file ?? "") ?? 0;
                        byFile.set(c.file ?? "", prev + 1);
                    }
                }
                for (const [file, count] of byFile) {
                    if (count > 0) {
                        w.recordBlockers(file, count);
                    }
                }
                // Files with no blocking comments pass
                const blockingFiles = new Set(byFile.keys());
                for (const c of comments) {
                    const f = c.file ?? "";
                    if (!blockingFiles.has(f) && f) {
                        w.recordReviewPass(f);
                    }
                }
                break;
            }
        }
    }
    _reviewReportPath(loopId, iteration) {
        return `${ensureHerdrWorkspace().reviews}/${loopId}-review-${iteration}.md`;
    }
    _releaseLease(taskId) {
        try {
            this.leaseManager.release(taskId, this.agentId);
        }
        catch (err) {
            console.error(`[daemon] Failed to release lease for ${taskId}: ${err}`);
        }
    }
    // ─── Notifications ────────────────────────────────────────────────────
    _notifyHumanReviewNeeded(task, reason) {
        if (!this.notificationCenter)
            return;
        console.log(`[daemon] Notifying HumanReviewNeeded: ${reason}`);
        this.notificationCenter
            .notify("HumanReviewNeeded", {
            jobId: task.taskId,
            requirement: task.request,
            taskId: task.taskId,
            error: reason,
        })
            .catch((err) => {
            console.warn(`[daemon] Notification failed: ${err}`);
        });
    }
    _notifyReadyForClient(task) {
        if (!this.notificationCenter)
            return;
        console.log(`[daemon] Notifying ReadyForClient`);
        this.notificationCenter
            .notify("ReadyForClient", {
            jobId: task.taskId,
            requirement: task.request,
            taskId: task.taskId,
        })
            .catch((err) => {
            console.warn(`[daemon] Notification failed: ${err}`);
        });
    }
    _buildChannels(cfg) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const channels = [];
        if (cfg.telegramBotToken && cfg.telegramChatId) {
            channels.push({
                id: "telegram",
                type: "telegram",
                enabled: true,
                config: { botToken: cfg.telegramBotToken, chatId: cfg.telegramChatId },
            });
        }
        if (cfg.ntfyTopic) {
            channels.push({
                id: "ntfy",
                type: "ntfy",
                enabled: true,
                config: { server: "https://ntfy.sh", topic: cfg.ntfyTopic },
            });
        }
        if (cfg.webhookUrl) {
            channels.push({
                id: "webhook",
                type: "webhook",
                enabled: true,
                config: { url: cfg.webhookUrl },
            });
        }
        return channels;
    }
}
// ─── Default export ─────────────────────────────────────────────────────────
export { LoopDaemon as default };
//# sourceMappingURL=daemon.js.map
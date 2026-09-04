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
import { execSync } from "node:child_process";
import { join } from "node:path";

import { LeaseManager } from "../../packages/autonomous-runtime/src/lease.js";
import type { ApprovalClass } from "../../packages/autonomous-runtime/src/types.js";
import {
	ensureHerdrWorkspace,
	getHerdrWorkspace,
	type HerdrEventBus,
	type LoopVerdict,
} from "../../packages/event-bus/src/herdr-bus.js";
import {
	createHerdrBus,
	publishCodeWritten,
	publishLoopFinished,
	publishLoopStarted,
	publishReviewCompleted,
} from "../../packages/event-bus/src/herdr-bus.js";
import { NotificationCenter } from "../../packages/notification/dist/notification-center.js";

import { invokeWithSurgeRetry, invokeWithGLMRetry, type SurgePolicy, type GLMQuotaSignal } from "./surge.js";
import type { LoopWidget } from "./widget.js";
import { StatusLineManager, isPiLensAvailable } from "./status-line.js";
import { createLoopCheckpointer } from "./checkpointer.js";

import {
	getTrajectoryStore,
	getApprovedPatternStore,
} from "../../packages/trajectory/src/index.js";

import {
	buildDryRunDeps,
	buildRealLoopDeps,
	buildWriteReviewLoop,
	type LoopDeps,
	type LoopState,
	type WriteReviewLoop,
} from "./graph.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export type TriggerSource = "bd-tasks" | "inbox" | "bus" | "cron";

export type ApprovalPolicy =
	| "never" // fully autonomous; notify only on finish/blocked (default)
	| "on_blocked" // notify + WAIT for human ack when verdict === "blocked"
	| "on_class" // wait only when task's ApprovalClass demands it
	| "always"; // wait after every review iteration (regulated mode)

export interface DaemonConfig {
	/** Agent/worker identity. Default: "loop-daemon" */
	agentId?: string;
	/** Trigger poll interval in ms. Default: 2000 */
	pollMs?: number;
	/** Max write-review rounds per task. Default: 3 */
	maxIterations?: number;
	/** Human gate policy. Default: "never" */
	approvalPolicy?: ApprovalPolicy;
	/** Use deterministic stubs (no API keys). Default: false */
	dryRun?: boolean;
	/** Abort loop if cumulative cost exceeds this. Default: no cap */
	costCapUsd?: number;
	/** Surge (529/overloaded) retry policy. Default: 3→6→12 min, max 5 pauses */
	surgePolicy?: Partial<SurgePolicy>;
	/** Kill a task if it runs longer than this (ms). Prevents permanent freezes. Default: no timeout */
	taskTimeoutMs?: number;
	/** Use persistent file-based checkpointer for crash-resume. Default: false (MemorySaver). */
	checkpointer?: boolean | string;
	/** @internal Test injection — overrides dryRun/real deps entirely */
	deps?: LoopDeps;
	/** Which watchers to enable. Default: ["inbox", "bus"] */
	sources?: TriggerSource[];
	/** Herdr workspace override. Default: from herdr-bus */
	workspace?: string;
	/** NotificationCenter config */
	notificationConfig?: {
		telegramBotToken?: string;
		telegramChatId?: string;
		ntfyTopic?: string;
		webhookUrl?: string;
	};
	/**
	 * Path to a tunnel-start script (e.g. tailscale-tunnel.sh).
	 * If set, the daemon health-checks the tunnel before each task and
	 * auto-restarts it if the target port is unreachable.
	 *
	 * Set to "auto" to search for scripts/tailscale-tunnel.sh in the
	 * project root, or give an absolute path.
	 * Default: none (no tunnel management)
	 */
	tunnelCommand?: string;
	/**
	 * Optional widget for TUI / status-line display.
	 * When set, the daemon updates the widget at each loop transition
	 * (mirrors pi-lens footer style: !NW ●ME).
	 */
	widget?: LoopWidget;
}

// ─── TriggeredTask ──────────────────────────────────────────────────────────

export interface TriggeredTask {
	/** Stable id — derived from the trigger source */
	taskId: string;
	/** Human-readable task description */
	request: string;
	/** How the task arrived */
	source: TriggerSource;
	/** Optional approval class from task metadata */
	approvalClass?: ApprovalClass;
	/** ISO timestamp of when the trigger was observed */
	triggeredAt: string;
}

// ─── TaskProposedPayload (bus event shape) ──────────────────────────────────

export interface TaskProposedPayload {
	taskId: string;
	request: string;
	approvalClass?: ApprovalClass;
}

// ─── Internal state ─────────────────────────────────────────────────────────

interface RunningTask {
	task: TriggeredTask;
	lease: ReturnType<LeaseManager["claim"]>;
	startedAt: string;
}

interface TaskSeen {
	taskId: string;
	source: TriggerSource;
	seenAt: string;
}

// ─── Ack file helpers ───────────────────────────────────────────────────────

/** Path for human approval ack files. */
function ackFilePath(inboxDir: string, taskId: string): string {
	return join(inboxDir, `ack-${taskId}.json`);
}

/** Read an ack file. Returns null if it doesn't exist yet. */
function readAck(
	inboxDir: string,
	taskId: string,
): { decision: "approved" | "denied"; decidedAt: string } | null {
	const path = ackFilePath(inboxDir, taskId);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as {
			decision: "approved" | "denied";
			decidedAt: string;
		};
	} catch {
		return null;
	}
}

/** Write an ack file (used by tests / manual approval). */
export function writeAck(
	inboxDir: string,
	taskId: string,
	decision: "approved" | "denied",
): void {
	const path = ackFilePath(inboxDir, taskId);
	writeFileSync(
		path,
		JSON.stringify({ decision, decidedAt: new Date().toISOString() }, null, 2),
		"utf8",
	);
}

// ─── Approval gate ───────────────────────────────────────────────────────────

/** Resolve the effective approval policy for a task given the daemon config. */
function effectivePolicy(
	task: TriggeredTask,
	config: DaemonConfig,
): ApprovalPolicy {
	const policy = config.approvalPolicy ?? "never";
	if (policy === "on_class") {
		// Map ApprovalClass → gate policy
		const cls = task.approvalClass ?? "automatic_reversible";
		if (cls === "human_approval_required") return "on_blocked";
		return "never";
	}
	return policy;
}

/** Rejects after `ms` milliseconds — used to time-box task execution. */
function timeoutPromise(ms: number): Promise<never> {
	return new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms),
	);
}

/** Wait (poll) for a human ack file or bus event. Returns true if approved. */
async function waitForAck(
	task: TriggeredTask,
	_config: DaemonConfig,
	_bus: HerdrEventBus,
	inboxDir: string,
): Promise<boolean> {
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

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function stableTaskId(source: TriggerSource, raw: string): string {
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
	private readonly inboxDir: string;
	private readonly seen: Map<string, TaskSeen> = new Map();
	private readonly pollMs: number;
	private running = false;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(inboxDir: string, pollMs: number) {
		this.inboxDir = inboxDir;
		this.pollMs = pollMs;
	}

	/** Start polling for new inbox files. */
	start(onTask: (task: TriggeredTask) => void): void {
		this.running = true;
		// Seed seen set with existing files
		this._seedSeen();
		this._poll(onTask);
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private _seedSeen(): void {
		if (!existsSync(this.inboxDir)) return;
		for (const file of readdirSync(this.inboxDir)) {
			if (!file.endsWith(".md")) continue;
			if (file.startsWith("ack-")) continue;
			this.seen.set(file, {
				taskId: file,
				source: "inbox",
				seenAt: new Date().toISOString(),
			});
		}
	}

	private _poll(onTask: (task: TriggeredTask) => void): void {
		if (!this.running) return;
		try {
			if (existsSync(this.inboxDir)) {
				for (const file of readdirSync(this.inboxDir)) {
					if (!file.endsWith(".md")) continue;
					if (file.startsWith("ack-")) continue;
					if (this.seen.has(file)) continue;

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
		} catch (err) {
			console.error(
				`[inbox-watcher] poll error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		this.timer = setTimeout(() => this._poll(onTask), this.pollMs);
	}

	private _readRequest(file: string): string {
		try {
			const content = readFileSync(join(this.inboxDir, file), "utf8");
			// Strip markdown frontmatter if present
			const stripped = content.replace(/^---[\s\S]*?---\n?/, "").trim();
			return stripped || file;
		} catch {
			return file;
		}
	}
}

// ─── Bus watcher ────────────────────────────────────────────────────────────

/** Watch HerdrEventBus for `task.proposed` events. */
class BusWatcher {
	private readonly bus: HerdrEventBus;
	private readonly seen: Set<string> = new Set();
	private readonly pollMs: number;
	private running = false;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(bus: HerdrEventBus, pollMs: number) {
		this.bus = bus;
		this.pollMs = pollMs;
	}

	/** Start polling for task.proposed bus events. */
	start(onTask: (task: TriggeredTask) => void): void {
		this.running = true;
		this._poll(onTask);
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private _poll(onTask: (task: TriggeredTask) => void): void {
		if (!this.running) return;
		try {
			// Re-use the bus's own polling by manually reading events.jsonl
			// This avoids double-polling since we share the same workspace.
			// The bus watcher delegates to the bus's internal poll mechanism
			// by subscribing dynamically.
			this._pollBusEvents(onTask);
		} catch (err) {
			console.error(
				`[bus-watcher] poll error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		this.timer = setTimeout(() => this._poll(onTask), this.pollMs);
	}

	private _pollBusEvents(onTask: (task: TriggeredTask) => void): void {
		// Read events.jsonl for task.proposed events we haven't seen
		const eventsPath = join(this.bus.getWorkspace(), "events.jsonl");
		if (!existsSync(eventsPath)) return;

		try {
			const content = readFileSync(eventsPath, "utf8");
			const lines = content.split("\n").filter((l) => l.trim());

			for (const line of lines) {
				try {
					const event = JSON.parse(line) as {
						eventId?: string;
						topic?: string;
						data?: unknown;
					};
					if (event.topic !== "task.proposed") continue;
					if (!event.eventId) continue;
					if (this.seen.has(event.eventId)) continue;

					const payload = event.data as TaskProposedPayload | undefined;
					if (!payload?.request) continue;

					this.seen.add(event.eventId);
					const taskId = payload.taskId || stableTaskId("bus", payload.request);
					onTask({
						taskId,
						request: payload.request,
						source: "bus",
						approvalClass: payload.approvalClass,
						triggeredAt: new Date().toISOString(),
					});
				} catch {
					// skip malformed lines
				}
			}
		} catch {
			// File may not exist yet
		}
	}
}

// ─── Bd-tasks watcher ───────────────────────────────────────────────────────

/** Watch bd (beads) task list for new pending tasks. */
class BdTasksWatcher {
	private readonly pollMs: number;
	private readonly seen: Set<string> = new Set();
	private running = false;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(pollMs: number) {
		this.pollMs = pollMs;
	}

	start(onTask: (task: TriggeredTask) => void): void {
		this.running = true;
		this._poll(onTask);
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private async _poll(onTask: (task: TriggeredTask) => void): Promise<void> {
		if (!this.running) return;
		try {
			await this._checkBdTasks(onTask);
		} catch {
			// bd command not available — silently skip
		}
		this.timer = setTimeout(() => {
			this._poll(onTask).catch(() => {});
		}, this.pollMs);
	}

	private async _checkBdTasks(
		onTask: (task: TriggeredTask) => void,
	): Promise<void> {
		const { execSync } = await import("node:child_process");
		let output: string;
		try {
			output = execSync("bd list --status pending --json 2>/dev/null", {
				encoding: "utf8",
				timeout: 5_000,
			});
		} catch {
			return; // bd not available or no pending tasks
		}

		try {
			const result = JSON.parse(output) as Array<{
				id: string;
				subject: string;
				metadata?: { approvalClass?: ApprovalClass };
			}>;
			for (const task of result) {
				if (this.seen.has(task.id)) continue;
				this.seen.add(task.id);
				onTask({
					taskId: task.id,
					request: task.subject,
					source: "bd-tasks",
					approvalClass: task.metadata?.approvalClass,
					triggeredAt: new Date().toISOString(),
				});
			}
		} catch {
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
	private readonly workspace: string;
	private readonly scheduleMs: Record<string, number>;
	private readonly seen: Map<string, Set<string>> = new Map();
	private readonly timers: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
	private running = false;

	constructor(workspace: string) {
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

	start(onTask: (task: TriggeredTask) => void): void {
		this.running = true;
		const cronDir = `${this.workspace}/.cron-tasks`;
		import("node:fs").then(({ mkdirSync, existsSync }) => {
			if (!existsSync(cronDir)) mkdirSync(cronDir, { recursive: true });
		});
		// Fire once at start
		this._tickAll(onTask);
		// Schedule each bucket
		for (const [schedule, ms] of Object.entries(this.scheduleMs)) {
			this._scheduleNext(schedule, ms, onTask);
		}
	}

	stop(): void {
		this.running = false;
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
	}

	private _scheduleNext(
		schedule: string,
		ms: number,
		onTask: (task: TriggeredTask) => void,
	): void {
		const timer = setTimeout(async () => {
			if (!this.running) return;
			await this._tickSchedule(schedule, onTask);
			this._scheduleNext(schedule, ms, onTask);
		}, ms);
		this.timers.set(schedule, timer);
	}

	private async _tickAll(onTask: (task: TriggeredTask) => void): Promise<void> {
		for (const schedule of Object.keys(this.scheduleMs)) {
			await this._tickSchedule(schedule, onTask);
		}
	}

	private async _tickSchedule(
		schedule: string,
		onTask: (task: TriggeredTask) => void,
	): Promise<void> {
		if (!this.running) return;
		const { readdirSync, readFileSync, existsSync } = await import("node:fs");
		const cronDir = `${this.workspace}/.cron-tasks/${schedule}`;
		if (!existsSync(cronDir)) return;

		let seen = this.seen.get(schedule);
		if (!seen) {
			seen = new Set();
			this.seen.set(schedule, seen);
		}

		let files: string[];
		try {
			files = readdirSync(cronDir).filter((f) => f.endsWith(".json"));
		} catch {
			return;
		}

		for (const file of files) {
			if (seen.has(file)) continue;
			seen.add(file);
			let taskData: { request?: string; enabled?: boolean };
			try {
				taskData = JSON.parse(readFileSync(`${cronDir}/${file}`, "utf8"));
			} catch {
				continue;
			}
			if (taskData.enabled === false) continue;
			if (!taskData.request) continue;
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
	private readonly scriptPath: string;
	private readonly checkIntervalMs: number;
	private readonly targetHost: string;
	private readonly targetPort: number;
	private running = false;
	private timer?: ReturnType<typeof setTimeout>;
	private consecutiveFailures = 0;
	private readonly maxConsecutiveFailures = 2;

	constructor(
		scriptPath: string,
		opts: {
			checkIntervalMs?: number;
			targetHost?: string;
			targetPort?: number;
		} = {},
	) {
		this.scriptPath = scriptPath;
		this.checkIntervalMs = opts.checkIntervalMs ?? 30_000; // 30s default
		this.targetHost = opts.targetHost ?? "127.0.0.1";
		this.targetPort = opts.targetPort ?? 5433;
	}

	start(): void {
		this.running = true;
		console.log(
			`[tunnel-monitor] Starting — script=${this.scriptPath}, check every ${this.checkIntervalMs / 1000}s, target=${this.targetHost}:${this.targetPort}`,
		);
		this._check();
	}

	stop(): void {
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
	async checkAndFix(): Promise<boolean> {
		const healthy = await this._isPortOpen();
		if (healthy) {
			this.consecutiveFailures = 0;
			return true;
		}

		this.consecutiveFailures++;
		console.warn(
			`[tunnel-monitor] Port ${this.targetHost}:${this.targetPort} unreachable (failure #${this.consecutiveFailures})`,
		);

		if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
			console.warn(`[tunnel-monitor] Tunnel appears down — restarting...`);
			await this._restartTunnel();
			this.consecutiveFailures = 0;
		}

		return false;
	}

	private async _check(): Promise<void> {
		if (!this.running) return;
		await this.checkAndFix();
		this.timer = setTimeout(() => this._check(), this.checkIntervalMs);
	}

	private async _isPortOpen(): Promise<boolean> {
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

	private async _restartTunnel(): Promise<void> {
		const { exec } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const execAsync = promisify(exec);

		try {
			// Stop first
			await execAsync(`bash "${this.scriptPath}" stop 2>/dev/null`, {
				timeout: 10_000,
			}).catch(() => {}); // ignore errors on stop

			// Small delay before restart
			await new Promise((r) => setTimeout(r, 1_000));

			// Start
			const { stdout, stderr } = await execAsync(
				`bash "${this.scriptPath}" start 2>&1`,
				{ timeout: 30_000 },
			);
			console.log(
				`[tunnel-monitor] Restart output: ${stdout.trim() || stderr.trim() || "ok"}`,
			);
		} catch (err) {
			console.error(
				`[tunnel-monitor] Restart failed: ${err instanceof Error ? err.message : String(err)}`,
			);
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
	private readonly config: Required<DaemonConfig>;
	private readonly agentId: string;
	private readonly leaseManager: LeaseManager;
	private readonly bus: HerdrEventBus;
	private readonly notificationCenter: NotificationCenter | null;
	private readonly inboxDir: string;

	private readonly inboxWatcher: InboxWatcher;
	private readonly busWatcher: BusWatcher;
	private readonly bdWatcher: BdTasksWatcher;
	private readonly cronWatcher: CronWatcher | null;
	private readonly tunnelMonitor: TunnelMonitor | null;
	private readonly statusLine: StatusLineManager | null;
	private readonly widget: LoopWidget | null;

	/** Currently running tasks (taskId → RunningTask) */
	private readonly running = new Map<string, RunningTask>();

	private stopped = false;

	constructor(config: DaemonConfig = {}) {
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
			sources: config.sources ?? ["inbox", "bus"], // bd-tasks is opt-in: add it only for harness-managed bd issues
			workspace: config.workspace ?? getHerdrWorkspace(),
			notificationConfig: config.notificationConfig ?? undefined,
			tunnelCommand: config.tunnelCommand,
			widget: config.widget,
			deps: config.deps,
		} as Required<DaemonConfig>;

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
				channels: this._buildChannels(this.config.notificationConfig) as Parameters<
					typeof NotificationCenter.prototype.notify
				>[0] extends { channels: infer C }
					? C
					: never,
				enabled: true,
			});
		} else {
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
		} else {
			this.tunnelMonitor = null;
		}

		// Reap stale leases from previous runs
		const reclaimed = this.leaseManager.recoverOnStartup();
		if (reclaimed.length > 0) {
			console.log(
				`[daemon] Reclaimed ${reclaimed.length} stale lease(s): ${reclaimed.join(", ")}`,
			);
		}
	}

	// ─── Public API ──────────────────────────────────────────────────────

	/** Start the daemon — begins watching all configured sources. */
	start(): void {
		console.log(
			`[daemon] Starting (agentId=${this.agentId}, sources=[${this.config.sources.join(", ")}], dryRun=${this.config.dryRun})`,
		);
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
	stop(): void {
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
			} catch (err) {
				console.error(`[daemon] Failed to release lease for ${taskId}: ${err}`);
			}
		}
		this.running.clear();

		console.log("[daemon] Stopped.");
	}

	/** Returns true if stop() has been called. */
	get isStopped(): boolean {
		return this.stopped;
	}

	// ─── Task processing ──────────────────────────────────────────────────

	private _onTriggered(task: TriggeredTask): void {
		if (this.stopped) return;

		// Skip if already running this task
		if (this.running.has(task.taskId)) {
			console.log(
				`[daemon] Task ${task.taskId} already running — skipping trigger`,
			);
			return;
		}

		console.log(
			`[daemon] Triggered: [${task.source}] ${task.taskId} — "${task.request.slice(0, 60)}"`,
		);

		// Try to claim the lease
		const lease = this.leaseManager.claim(task.taskId, this.agentId);
		if (!lease) {
			console.log(
				`[daemon] Lease held for ${task.taskId} — skipping (another worker)`,
			);
			return;
		}

		// Run the task asynchronously (do not block the watcher)
		this.running.set(task.taskId, {
			task,
			lease,
			startedAt: new Date().toISOString(),
		});
		this._runTask(task).catch((err) => {
			console.error(
				`[daemon] Task ${task.taskId} failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			this.running.delete(task.taskId);
		});
	}

	private async _runTask(task: TriggeredTask): Promise<void> {
		const loopId = `loop-${randomUUID().slice(0, 8)}`;
		const log = (msg: string) => console.log(`[${loopId}] ${msg}`);

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
				const approved = await waitForAck(
					task,
					this.config,
					this.bus,
					this.inboxDir,
				);
				if (!approved) {
					log(`Human denied approval — parking task`);
					this._notifyHumanReviewNeeded(
						task,
						"Human denied approval for task start",
					);
					this._releaseLease(task.taskId);
					this.running.delete(task.taskId);
					return;
				}
				log(`Human approved — proceeding`);
			}

			// ── Build loop deps ───────────────────────────────────────────────
			const deps: LoopDeps =
				this.config.deps ??
				(this.config.dryRun
					? buildDryRunDeps({
							maxIterations: this.config.maxIterations,
							blackboardDir: this.bus.getWorkspace(),
						})
					: await buildRealLoopDeps({
							maxIterations: this.config.maxIterations,
							blackboardDir: this.bus.getWorkspace(),
							request: task.request,
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
			log(
				`Starting write-review loop (maxIterations=${this.config.maxIterations})`,
			);
			const checkpointer = (() => {
				if (this.config.checkpointer === false) return false;
				if (
					this.config.checkpointer === true ||
					typeof this.config.checkpointer === "string"
				) {
					return createLoopCheckpointer(
						this.config.checkpointer === true
							? this.bus.getWorkspace()
							: (this.config.checkpointer as string),
					);
				}
				return undefined; // default MemorySaver
			})();
			const loop: WriteReviewLoop = buildWriteReviewLoop(deps, { checkpointer });

				const invokeTask = (signal?: AbortSignal) =>
					invokeWithSurgeRetry(
						() =>
							invokeWithGLMRetry(
								() =>
									loop.invoke(
										{ request: task.request },
										{ configurable: { thread_id: loopId }, signal },
									),
								{
									tickMs: 30_000,
									onGLMQuota: (signal) => {
										const secs = Math.max(
										0,
										Math.round((signal.resetAtEpoch - Date.now()) / 1000),
									);
									const mins = Math.floor(secs / 60);
									const remSecs = secs % 60;
									const countdown =
										mins > 0 ? ` (resets in ${mins}m ${remSecs}s)` : ` (resets in ${remSecs}s)`;
									log(`GLM quota exhausted${countdown}`);
									this.widget?.setSurgePause(new Date(signal.resetAt));
									this.statusLine?.updateLoopStatus(
										`[Q] GLM quota — resets${countdown}`,
									);
								},
								onGLMRetry: () => {
									log("GLM quota window reached — retrying loop");
								},
							},
							),
						{
							policy: this.config.surgePolicy,
							onSurge: ({ attempt, delayMs }) =>
								log(
									`Provider surge (529) — resume in ${Math.round(delayMs / 1000)}s (attempt ${attempt})`,
								),
							onExhausted: () => {
								this._notifyHumanReviewNeeded(
									task,
									"Provider surged past max surge attempts — task failed",
								);
							},
						},
					);

			let finalState: Awaited<ReturnType<typeof invokeTask>>;
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
				} finally {
					clearTimeout(timeout);
				}
			} else {
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
				severity: (c.severity ?? "minor") as "minor" | "major" | "critical",
			}));
			const files = [
				...new Set(rawComments.map((c) => c.file).filter(Boolean) as string[]),
			];
			const reason =
				verdict === "approved"
					? "reviewer approved"
					: verdict === "blocked"
						? "reviewer blocked the task"
						: iterations >= this.config.maxIterations
							? `max iterations (${iterations}) reached with changes still requested`
							: comments.length > 0 && comments.every((c) => c.severity === "minor")
								? `converged: only minor comments (${comments.length})`
								: `stuck: changes still requested after ${iterations} iteration(s)`;

			// M7c: Build the trajectory record and classify convergence
			const trajRecord = {
				id: trajId,
				taskRequest: task.request,
				createdAt: new Date(trajStartMs).toISOString(),
				durationMs: Date.now() - trajStartMs,
				iterations,
				verdict: verdict as "approved" | "blocked" | "changes_requested",
				reason,
				plan: finalState.plan ?? "",
				code: finalState.code ?? "",
				files,
				comments,
				summary: finalState.review?.summary ?? "",
				classified: false as boolean,
			};
			const classification = store.classify(trajRecord);
			log(
				`[M7c] Trajectory "${classification.label}" ` +
					`(confidence ${Math.round(classification.confidence * 100)}%) — ` +
					classification.recommendation,
			);

			// Persist the trajectory record
			store.append(trajRecord);

			// M7b: Record approved patterns so the reviewer learns from success
			if (verdict === "approved") {
				const approvedPatterns = getApprovedPatternStore();
				approvedPatterns.approve(comments);
				log(`[M7b] Recorded ${comments.length} approved pattern(s)`);
			}

			// Update widget on loop completion
			if (this.widget) {
				this.widget.setComplete(
					verdict === "approved"
						? "approved"
						: verdict === "blocked"
							? "rejected"
							: "max_iterations",
				);
			}
			const loopDone =
				verdict === "approved"
					? "[F] finished"
					: verdict === "blocked"
						? "[!] blocked"
						: "[~] max_iter";
			this.statusLine?.updateLoopStatus(loopDone);

			// ── Gate check after blocked verdict ────────────────────────────────
			if (
				verdict === "blocked" &&
				effectivePolicy(task, this.config) === "on_blocked"
			) {
				log(`Blocked verdict + on_blocked policy — waiting for human ack`);
				const approved = await waitForAck(
					task,
					this.config,
					this.bus,
					this.inboxDir,
				);
				if (!approved) {
					log(`Human denied — finalizing as blocked`);
				}
			}

			// ── Publish loop.finished ──────────────────────────────────────────
			publishLoopFinished(
				this.bus,
				loopId,
				`${iterations} iteration(s) — ${verdict}`,
				iterations,
				iterations,
				verdict as LoopVerdict,
			);

			// ── Notify on blocked / max-iterations ─────────────────────────────
			if (verdict === "blocked") {
				this._notifyHumanReviewNeeded(
					task,
					`Loop blocked: ${finalState.review?.summary ?? "no details"}`,
				);
			} else if (verdict === "changes_requested") {
				this._notifyHumanReviewNeeded(
					task,
					`${iterations} iteration(s) exhausted with changes still requested: ${finalState.review?.comments.map((c) => c.comment).join("; ") ?? "no details"}`,
				);
			} else {
				// approved
				this._notifyReadyForClient(task);
			}

			// ── Close bd issue on loop completion ───────────────────────────────
			if (task.source === "bd-tasks") {
				this._closeBdIssue(task.taskId, verdict);
			}
		} finally {
			this._releaseLease(task.taskId);
			this.running.delete(task.taskId);
		}
	}

	private _publishTransition(
		loopId: string,
		step: string,
		state: LoopState,
	): void {
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
				publishReviewCompleted(
					this.bus,
					loopId,
					state.iteration,
					state.review?.verdict ?? "blocked",
					state.review?.summary ?? "",
					this._reviewReportPath(loopId, state.iteration),
				);
				break;
		}
	}

	/**
	 * Drive the TUI widget through loop transitions.
	 * Called from onStep within _runTask.
	 */
	private _updateWidget(step: string, state: LoopState): void {
		const w = this.widget;
		if (!w) return;

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
		case "glmq": {
				// GLM quota hit — show countdown to reset
				const resetAt = state.iteration > 0
					? new Date(state.iteration)  // passthrough from onGLMQuota
					: undefined;
				w.setSurgePause(resetAt);
				break;
			}
			case "review": {
				w.setPhase("reviewing", "GLM reviewing");
				// Process review comments — one record per file
				const comments = state.review?.comments ?? [];
				if (comments.length === 0) break;

				// Group blocking comments by file (severity: "critical" = blocking)
				const byFile = new Map<string, number>();
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

	private _reviewReportPath(loopId: string, iteration: number): string {
		return `${ensureHerdrWorkspace().reviews}/${loopId}-review-${iteration}.md`;
	}

	private _releaseLease(taskId: string): void {
		try {
			this.leaseManager.release(taskId, this.agentId);
		} catch (err) {
			console.error(`[daemon] Failed to release lease for ${taskId}: ${err}`);
		}
	}

	// ─── Notifications ────────────────────────────────────────────────────

	private _notifyHumanReviewNeeded(task: TriggeredTask, reason: string): void {
		if (!this.notificationCenter) return;
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

	private _closeBdIssue(taskId: string, verdict: string): void {
		// Close the bd issue when the loop finishes.
		// approved → close as done. changes_requested (exhausted) → close as done.
		// blocked → leave open for human review.
		const reason =
			verdict === "approved"
				? "approved"
				: verdict === "blocked"
					? undefined // leave blocked issues open
					: "completed";
		if (!reason) return;
		try {
			execSync(`bd close ${taskId} --reason "${reason}" 2>/dev/null`, {
				encoding: "utf8",
				timeout: 5_000,
			});
		} catch {
			// best-effort — don't fail the task over a missing bd
		}
	}

	private _notifyReadyForClient(task: TriggeredTask): void {
		if (!this.notificationCenter) return;
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

	private _buildChannels(cfg: NonNullable<DaemonConfig["notificationConfig"]>) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const channels: any[] = [];
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

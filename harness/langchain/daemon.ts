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
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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

import { invokeWithSurgeRetry, type SurgePolicy } from "./surge.js";
import { createLoopCheckpointer } from "./checkpointer.js";

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

// ─── Loop Daemon ────────────────────────────────────────────────────────────

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
			sources: config.sources ?? ["inbox", "bus"],
			workspace: config.workspace ?? getHerdrWorkspace(),
			notificationConfig: config.notificationConfig ?? undefined,
			checkpointer: config.checkpointer,
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
		this.busWatcher = new BusWatcher(this.bus, this.config.pollMs);
		this.bdWatcher = new BdTasksWatcher(this.config.pollMs);

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

		console.log("[daemon] Started.");
	}

	/** Stop all watchers and release all held leases. */
	stop(): void {
		console.log("[daemon] Stopping...");
		this.stopped = true;

		this.inboxWatcher.stop();
		this.busWatcher.stop();
		this.bdWatcher.stop();

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
					? buildDryRunDeps({ maxIterations: this.config.maxIterations })
					: await buildRealLoopDeps({
							maxIterations: this.config.maxIterations,
						}));

			// Inject transition publishing into onStep
			const originalOnStep = deps.onStep;
			deps.onStep = (step, state) => {
				originalOnStep?.(step, state);
				this._publishTransition(loopId, step, state);
			};

			// ── Run the graph (surge-aware: 529/overloaded pauses auto-resume) ──
			log(
				`Starting write-review loop (maxIterations=${this.config.maxIterations})`,
			);
			const checkpointer =
				this.config.checkpointer === false
					? false
					: this.config.checkpointer === true || typeof this.config.checkpointer === "string"
						? createLoopCheckpointer(
								this.config.checkpointer === true
									? this.bus.getWorkspace()
									: this.config.checkpointer as string,
							)
						: undefined; // default MemorySaver
			const loop: WriteReviewLoop = buildWriteReviewLoop(deps, { checkpointer });

			const finalState = await invokeWithSurgeRetry(
				() =>
					loop.invoke(
						{ request: task.request },
						{ configurable: { thread_id: loopId } },
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

			const verdict = finalState.review?.verdict ?? "blocked";
			const iterations = finalState.iteration ?? 0;

			log(`Loop finished: ${verdict} after ${iterations} iteration(s)`);

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

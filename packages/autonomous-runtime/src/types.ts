/**
 * Autonomous Operations Runtime — TypeScript Contracts
 * Based on RFC-0101 §14
 *
 * Consumers: LoopRuntime, privilege-broker, scheduler-adapter, notification-runtime.
 * These types are the canonical contracts. Do not re-define them in other packages.
 */
import { env } from "node:process";

// ─── Capability model ──────────────────────────────────────────────────────────

/** A named capability that the privilege broker may grant. */
export type CapabilityName =
	| "files.read"
	| "files.write"
	| "files.exec"
	| "git.commit"
	| "git.push"
	| "git.pull"
	| "system.restart"
	| "system.restart-service"
	| "system.logs"
	| "bench.migrate"
	| "bench.build"
	| "bench.restart"
	| "okf.promote-pattern"
	| "okf.promote-lesson"
	| "notify.send"
	| "llm.invoke";

/** What approval class a capability requires. */
export type ApprovalClass =
	| "automatic_read_only" // safe, no side effects
	| "automatic_reversible" // side effects but trivially reversible
	| "human_approval_required" // must ask operator
	| "forbidden"; // never grant, regardless of override

// ─── Task lifecycle ───────────────────────────────────────────────────────────

export type TaskStatus =
	| "queued"
	| "claimed"
	| "running"
	| "waiting_approval"
	| "waiting_quota"
	| "retrying"
	| "completed"
	| "failed"
	| "dead_letter";

/** Immutable log of what happened to a task. */
export type TaskEvent = {
	ts: string; // ISO-8601
	kind:
		| "claimed"
		| "started"
		| "checkpointed"
		| "progress"
		| "blocked"
		| "approval_requested"
		| "approved"
		| "denied"
		| "failed"
		| "completed"
		| "recovered"
		| "dead_lettered"
		| "transitioned"; // generic status change
	payload?: Record<string, unknown>;
};

// ─── Task record ─────────────────────────────────────────────────────────────

/** The primary durable record for a task. */
export interface TaskRecord {
	id: string; // e.g. "task-2026-07-23-001"
	objective: string; // natural-language goal
	acceptanceCriteria: string[]; // verifiable outcomes
	source:
		| { kind: "chat"; userId: string }
		| { kind: "schedule"; scheduleId: string }
		| { kind: "webhook"; url: string }
		| { kind: "subagent"; parentTaskId: string }
		| { kind: "manual"; createdBy: string };
	priority: 0 | 1 | 2 | 3 | 4; // P0..P4 (RFC-0015 convention)
	capabilities: CapabilityName[]; // capabilities this task may need
	approvalClass: ApprovalClass; // initial class (may escalate)
	status: TaskStatus;
	attempts: number;
	maxAttempts: number; // default 3
	context?: ExecutionContext; // planner-provided inputs
	createdAt: string; // ISO-8601
	updatedAt: string; // ISO-8601
	leaseId?: string;
	result?: TaskResult;
	failureReason?: string;
	history: TaskEvent[];
}

// ─── Leasing ──────────────────────────────────────────────────────────────────

/** A lease held by a worker on a specific task. */
export interface TaskLease {
	taskId: string;
	workerId: string;
	acquiredAt: string; // ISO-8601
	expiresAt: string; // ISO-8601
	heartbeatAt: string; // ISO-8601
	attempt: number; // which attempt this lease covers
}

// ─── Worker registry ──────────────────────────────────────────────────────────

/** Heartbeat emitted by a worker every 5 s to worker-registry.json. */
export interface WorkerHeartbeat {
	workerId: string;
	startedAt: string;
	lastBeatAt: string;
	capacity: number; // max concurrent tasks
	inflightTaskIds: string[];
}

// ─── Privilege broker ─────────────────────────────────────────────────────────

/** A resolved grant from the privilege broker. */
export interface CapabilityGrant {
	name: CapabilityName;
	argv: string[]; // exact, no shell
	envWhitelist?: string[]; // env vars that may be passed
	user: string; // service account to run as
	cwd?: string; // working directory
	timeoutMs: number;
}

// ─── Approval ─────────────────────────────────────────────────────────────────

/** An in-flight human approval request. */
export interface ApprovalRequest {
	id: string;
	taskId: string;
	capability: CapabilityName;
	rationale: string; // human-readable description
	signedBy?: { keyFingerprint: string; ts: string };
	decision?: "approved" | "denied";
	decidedAt?: string;
	expiresAt: string; // ISO-8601 — timeout threshold
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/** A scheduled recurring task. */
export interface ScheduledTask {
	id: string;
	taskTemplate: Omit<TaskRecord, "id" | "status" | "attempts" | "createdAt" | "updatedAt" | "history">;
	schedule: ScheduleSpec;
	enabled: boolean;
	lastFiredAt?: string;
	nextFireAt?: string;
}

export type ScheduleSpec =
	| { kind: "cron"; expression: string }
	| { kind: "interval"; intervalMs: number }
	| { kind: "once"; at: string };

// ─── Notification ─────────────────────────────────────────────────────────────

export type RuntimeNotificationEvent =
	| "task.claimed"
	| "task.started"
	| "task.completed"
	| "task.failed"
	| "task.waiting_approval"
	| "task.dead_lettered"
	| "lease.expired"
	| "worker.started"
	| "worker.stopped"
	| "approval.approved"
	| "approval.denied"
	| "approval.expired";

export interface NotificationEvent {
	kind: RuntimeNotificationEvent;
	ts: string;
	taskId?: string;
	workerId?: string;
	payload: Record<string, unknown>;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

export interface Checkpoint {
	taskId: string;
	attempt: number;
	state: Record<string, unknown>;
	savedAt: string; // ISO-8601
}

// ─── Execution context ────────────────────────────────────────────────────────

/** The context given to the loop runtime when executing a task. */
export interface ExecutionContext {
	taskId: string;
	workerId: string;
	inputs: Record<string, unknown>;
	capabilitiesGranted: CapabilityName[];
	approvalClass: ApprovalClass;
	lease: TaskLease;
	checkpoint?: Checkpoint;
	okfBundles: string[]; // content hashes available to planner
}

// ─── Task result ─────────────────────────────────────────────────────────────

export interface TaskResult {
	taskId: string;
	status: "completed" | "failed" | "dead_letter";
	deliverables?: { path: string; mime: string }[];
	acceptanceCriteriaMet: { criterion: string; passed: boolean; evidence?: string }[];
	durationMs: number;
	modelUsage?: { inputTokens: number; outputTokens: number; provider: string };
}

// ─── Storage paths ────────────────────────────────────────────────────────────

const DEFAULT_ROOT = `${env["HOME"] ?? "."}/.pi/harness`;

/** Returns the standard storage root for the runtime. */
export function getRuntimeRoot(): string {
	return env["PI_HARNESS_RUNTIME_ROOT"] ?? DEFAULT_ROOT;
}

/** Returns the inbox directory path. */
export function getInboxDir(): string {
	return `${getRuntimeRoot()}/inbox`;
}

/** Returns the claimed leases directory path. */
export function getLeasesDir(): string {
	return `${getInboxDir()}/claimed`;
}

/** Returns the task JSONL file path. */
export function getTasksPath(): string {
	return `${getInboxDir()}/tasks.jsonl`;
}

/** Returns the worker registry path. */
export function getWorkerRegistryPath(): string {
	return `${getRuntimeRoot()}/worker-registry.json`;
}

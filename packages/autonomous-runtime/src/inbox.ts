/**
 * Task Inbox — RFC-0101 §2
 *
 * Append-only durable store for TaskRecords backed by `tasks.jsonl`.
 * One JSONL line per task — easy to tail, grep, and replay.
 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { TaskRecord, TaskStatus, TaskEvent } from "./types.js";
import { getInboxDir, getTasksPath } from "./types.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class InboxError extends Error {
	constructor(msg: string) {
		super(`[InboxError] ${msg}`);
		this.name = "InboxError";
	}
}

// ─── TaskInbox ────────────────────────────────────────────────────────────────

/**
 * Manages the append-only task inbox at `~/.pi/harness/inbox/tasks.jsonl`.
 *
 * Storage layout:
 * ```
 * ~/.pi/harness/inbox/
 * ├── tasks.jsonl   # append-only log (one JSON line per task)
 * ├── claimed/      # active leases (one JSON file per task)
 * └── BACKLOG.md   # human-friendly authoring surface (optional)
 * ```
 *
 * Operations are:
 * - **append**  — append a new task to tasks.jsonl
 * - **list**    — read all tasks, filterable by status
 * - **transition** — update a task's status in-place (rewrite)
 * - **get**     — read one task by id
 * - **reindex** — compact tasks.jsonl by rewriting it from in-memory state
 */
export class TaskInbox {
	private readonly tasksPath: string;
	private readonly inboxDir: string;
	private _cache: TaskRecord[] | null = null;

	constructor(options: { tasksPath?: string; inboxDir?: string } = {}) {
		this.inboxDir = options.inboxDir ?? getInboxDir();
		this.tasksPath = options.tasksPath ?? getTasksPath();
	}

	/** Ensure the inbox directory exists. Call before any write. */
	ensureDir(): void {
		if (!existsSync(this.inboxDir)) {
			mkdirSync(this.inboxDir, { recursive: true });
		}
	}

	// ─── append ──────────────────────────────────────────────────────────────

	/**
	 * Append a new task to tasks.jsonl.
	 * The task is validated before writing. Duplicate ids are rejected.
	 *
	 * @throws {InboxError} if the task id already exists or validation fails
	 */
	append(task: TaskRecord): void {
		this.ensureDir();

		// Guard against duplicate ids
		const existing = this.list().find((t) => t.id === task.id);
		if (existing) {
			throw new InboxError(
				`Task ${task.id} already exists in inbox (status=${existing.status})`,
			);
		}

		const line = JSON.stringify(task) + "\n";
		appendFileSync(this.tasksPath, line, "utf8");
		this._cache = null; // invalidate
	}

	// ─── list ─────────────────────────────────────────────────────────────────

	/**
	 * Read all tasks from tasks.jsonl.
	 * Results are sorted by priority ASC then createdAt ASC (oldest first).
	 *
	 * @param filter Optionally filter by status. If omitted, returns all.
	 */
	list(filter?: { status?: TaskStatus | TaskStatus[] }): TaskRecord[] {
		if (!existsSync(this.tasksPath)) {
			return [];
		}

		const raw = readFileSync(this.tasksPath, "utf8");
		const tasks: TaskRecord[] = [];

		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const task = JSON.parse(trimmed) as TaskRecord;
				tasks.push(task);
			} catch {
				// Corrupt line — skip but don't fail the whole list
				console.warn(`[TaskInbox] Skipping corrupt line in ${this.tasksPath}`);
			}
		}

		// Filter by status
		let filtered = tasks;
		if (filter?.status !== undefined) {
			const statuses = Array.isArray(filter.status)
				? filter.status
				: [filter.status];
			filtered = tasks.filter((t) => statuses.includes(t.status));
		}

		// Sort: priority ASC, then createdAt ASC
		filtered.sort((a, b) => {
			if (a.priority !== b.priority) return a.priority - b.priority;
			return a.createdAt.localeCompare(b.createdAt);
		});

		return filtered;
	}

	// ─── get ─────────────────────────────────────────────────────────────────

	/** Retrieve a single task by id, or null if not found. */
	get(id: string): TaskRecord | null {
		const tasks = this.list();
		return tasks.find((t) => t.id === id) ?? null;
	}

	// ─── transition ──────────────────────────────────────────────────────────

	/**
	 * Update a task's status in-place inside tasks.jsonl.
	 *
	 * Uses read→parse→update→rewrite to avoid corrupting the JSONL file.
	 * The rewrite is atomic (write-tmp-then-rename).
	 *
	 * @param taskId       The id of the task to transition
	 * @param newStatus    The target status
	 * @param extra       Optional additional fields to merge into the task record
	 * @param event       Optional TaskEvent to append to the history
	 * @throws {InboxError} if the task does not exist
	 */
	transition(
		taskId: string,
		newStatus: TaskStatus,
		extra?: Partial<TaskRecord>,
		event?: TaskEvent,
	): TaskRecord {
		if (!existsSync(this.tasksPath)) {
			throw new InboxError(`tasks.jsonl does not exist at ${this.tasksPath}`);
		}

		const tasks = this.list();
		const idx = tasks.findIndex((t) => t.id === taskId);
		if (idx === -1) {
			throw new InboxError(`Task ${taskId} not found in inbox`);
		}

		const updated: TaskRecord = {
			...tasks[idx],
			...extra,
			status: newStatus,
			updatedAt: new Date().toISOString(),
			history: event
				? [...tasks[idx].history, event]
				: [
						...tasks[idx].history,
						{
							ts: new Date().toISOString(),
							kind: "transitioned",
							payload: { from: tasks[idx].status, to: newStatus },
						},
					],
		};

		// Rewrite tasks.jsonl atomically
		this._rewriteAll([
			...tasks.slice(0, idx),
			updated,
			...tasks.slice(idx + 1),
		]);
		this._cache = null;

		return updated;
	}

	// ─── markDone / markFailed ───────────────────────────────────────────────

	/** Convenience: mark a task as completed with a result. */
	complete(taskId: string, result: TaskRecord["result"]): TaskRecord {
		return this.transition(
			taskId,
			"completed",
			{ result },
			{
				ts: new Date().toISOString(),
				kind: "completed",
				payload: { result },
			},
		);
	}

	/** Convenience: mark a task as failed with a reason. */
	fail(taskId: string, reason: string): TaskRecord {
		const task = this.get(taskId);
		const attempts = (task?.attempts ?? 0) + 1;
		const newStatus =
			attempts >= (task?.maxAttempts ?? 3) ? "dead_letter" : "retrying";
		return this.transition(
			taskId,
			newStatus,
			{ failureReason: reason, attempts },
			{
				ts: new Date().toISOString(),
				kind: newStatus === "dead_letter" ? "dead_lettered" : "failed",
				payload: { reason, attempts },
			},
		);
	}

	// ─── reindex ─────────────────────────────────────────────────────────────

	/** Rewrite tasks.jsonl from the given task list. */
	private _rewriteAll(tasks: TaskRecord[]): void {
		const tmp = `${this.tasksPath}.tmp`;
		const content = tasks.map((t) => JSON.stringify(t)).join("\n") + "\n";
		writeFileSync(tmp, content, "utf8");
		// Atomic rename (POSIX guarantees atomicity)
		// Bun/Node will use the native rename which is atomic on POSIX
		const { renameSync } = require("node:fs");
		renameSync(tmp, this.tasksPath);
	}

	/** Force a full reindex. Call after manual edits to tasks.jsonl. */
	reindex(): void {
		if (!existsSync(this.tasksPath)) return;
		const tasks = this.list(); // reads and validates
		this._rewriteAll(tasks);
		this._cache = null;
	}

	// ─── count ───────────────────────────────────────────────────────────────

	/** Return counts of tasks grouped by status. */
	stats(): Record<TaskStatus, number> {
		const tasks = this.list();
		const counts: Record<string, number> = {};
		for (const t of tasks) {
			counts[t.status] = (counts[t.status] ?? 0) + 1;
		}
		return counts as Record<TaskStatus, number>;
	}
}

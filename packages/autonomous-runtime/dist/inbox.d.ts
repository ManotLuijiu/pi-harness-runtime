import type { TaskRecord, TaskStatus, TaskEvent } from "./types.js";
export declare class InboxError extends Error {
    constructor(msg: string);
}
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
export declare class TaskInbox {
    private readonly tasksPath;
    private readonly inboxDir;
    private _cache;
    constructor(options?: {
        tasksPath?: string;
        inboxDir?: string;
    });
    /** Ensure the inbox directory exists. Call before any write. */
    ensureDir(): void;
    /**
     * Append a new task to tasks.jsonl.
     * The task is validated before writing. Duplicate ids are rejected.
     *
     * @throws {InboxError} if the task id already exists or validation fails
     */
    append(task: TaskRecord): void;
    /**
     * Read all tasks from tasks.jsonl.
     * Results are sorted by priority ASC then createdAt ASC (oldest first).
     *
     * @param filter Optionally filter by status. If omitted, returns all.
     */
    list(filter?: {
        status?: TaskStatus | TaskStatus[];
    }): TaskRecord[];
    /** Retrieve a single task by id, or null if not found. */
    get(id: string): TaskRecord | null;
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
    transition(taskId: string, newStatus: TaskStatus, extra?: Partial<TaskRecord>, event?: TaskEvent): TaskRecord;
    /** Convenience: mark a task as completed with a result. */
    complete(taskId: string, result: TaskRecord["result"]): TaskRecord;
    /** Convenience: mark a task as failed with a reason. */
    fail(taskId: string, reason: string): TaskRecord;
    /** Rewrite tasks.jsonl from the given task list. */
    private _rewriteAll;
    /** Force a full reindex. Call after manual edits to tasks.jsonl. */
    reindex(): void;
    /** Return counts of tasks grouped by status. */
    stats(): Record<TaskStatus, number>;
}
//# sourceMappingURL=inbox.d.ts.map
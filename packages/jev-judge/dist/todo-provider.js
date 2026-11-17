/**
 * Todo Provider - Read local todo state
 *
 * Provides typed access to the local todo list.
 * Separates todo from bd (issue tracker).
 */
/**
 * Mock Todo Provider for testing
 */
export class MockTodoProvider {
    items = [];
    _sessionId;
    _revision = 0;
    /** The state of the list after every change. */
    history = [];
    constructor(sessionId) {
        this._sessionId = sessionId ?? `mock-${Date.now()}`;
    }
    async availability() {
        return { available: true, provider: "mock" };
    }
    async getSnapshot() {
        this._revision++;
        return {
            items: [...this.items],
            sessionId: this._sessionId,
            revision: this._revision,
            createdAt: new Date(),
        };
    }
    async getByStatus(status) {
        return this.items.filter((item) => item.status === status);
    }
    async getHistory() {
        return this.history.map((entry) => ({ items: entry.items.map((item) => ({ ...item })) }));
    }
    async getInProgress() {
        return this.getByStatus("in_progress");
    }
    async getPending() {
        return this.items.filter((item) => item.status === "pending");
    }
    async getCompleted() {
        return this.getByStatus("completed");
    }
    async getReady() {
        const pending = await this.getPending();
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return true;
            const blockedIds = new Set(item.blockedBy);
            return !this.items.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
    async getBlocked() {
        const pending = await this.getPending();
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return false;
            const blockedIds = new Set(item.blockedBy);
            return this.items.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
    // Test helpers
    addItem(item) {
        const id = this.items.length + 1;
        const newItem = { ...item, id };
        this.items.push(newItem);
        this.record();
        return newItem;
    }
    setStatus(id, status) {
        const item = this.items.find((i) => i.id === id);
        if (item) {
            item.status = status;
            this.record();
        }
    }
    clear() {
        this.items = [];
        this._revision++;
        this.record();
    }
    /** Remember the state of the list after a change. */
    record() {
        this.history.push({ items: this.items.map((item) => ({ ...item })) });
    }
}
/**
 * Create a todo provider that reads from rpiv-todo state via session branch
 */
export function createTodoProvider(ctx) {
    // Accept either TodoContext or ExtensionAPI with sessionManager
    if (ctx && "sessionManager" in ctx) {
        return new PiTodoProvider(ctx);
    }
    return new PiUnavailableTodoProvider();
}
/**
 * The time of an entry, in milliseconds since the epoch.
 *
 * The entries of the branch carry a timestamp when the runtime writes one.
 * It is the order of two entries that both carry one.
 */
function entryTime(entry) {
    const candidates = [entry.timestamp, entry.createdAt, entry.message?.timestamp];
    for (const candidate of candidates) {
        if (candidate instanceof Date)
            return candidate.getTime();
        if (typeof candidate === "number" && Number.isFinite(candidate))
            return candidate;
        if (typeof candidate === "string") {
            const parsed = Date.parse(candidate);
            if (!Number.isNaN(parsed))
                return parsed;
        }
    }
    return undefined;
}
/**
 * Which of two candidates is the newer one.
 *
 * The branch is chronological, so the position decides. When both entries
 * carry a timestamp, the timestamp is the order.
 */
function compareCandidates(a, b) {
    if (a.at !== undefined && b.at !== undefined)
        return a.at - b.at;
    return a.position - b.position;
}
/**
 * Provider that reads rpiv-todo state from session branch
 * Replicates rpiv-todo's replayFromBranch logic to access todo state
 */
class PiTodoProvider {
    ctx;
    _revision = 0;
    _lastError = null;
    /**
     * The error of the last read of the list, when it failed.
     */
    get lastError() {
        return this._lastError;
    }
    constructor(ctx) {
        this.ctx = ctx;
    }
    async availability() {
        if (!this.ctx.sessionManager) {
            return {
                available: false,
                error: "Session manager not available",
                provider: "pi-todo",
            };
        }
        return { available: true, provider: "pi-todo" };
    }
    /**
     * Check if a value is a TaskDetails shape (defensive validation)
     */
    isTaskDetails(value) {
        if (!value || typeof value !== "object")
            return false;
        const v = value;
        return Array.isArray(v.tasks) && typeof v.nextId === "number";
    }
    /**
     * Get todo state from session branch (replicates rpiv-todo's replayFromBranch)
     * Returns null if branch read fails (don't silently return empty state)
     */
    getTodoState() {
        let fromEntries;
        let fromToolResults;
        try {
            const branch = this.ctx.sessionManager.getBranch();
            let position = 0;
            for (const entry of branch) {
                const candidate = this.stateCandidate(entry, position++);
                if (!candidate)
                    continue;
                if (candidate.source === "custom")
                    fromEntries = candidate;
                else
                    fromToolResults = candidate;
            }
        }
        catch (err) {
            // Return null on error - don't silently return empty state
            this._lastError = err instanceof Error ? err.message : String(err);
            return null;
        }
        this._lastError = null;
        if (!fromEntries)
            return fromToolResults?.state ?? null;
        if (!fromToolResults)
            return fromEntries.state;
        // The newer of the two sources wins: a read after an update must not
        // return the state from before the update. The custom entry used to
        // win by default, so a read could report a stale list.
        const newer = compareCandidates(fromEntries, fromToolResults) >= 0 ? fromEntries : fromToolResults;
        return newer.state;
    }
    /**
     * The state of the list that an entry of the branch carries, when it
     * carries one.
     */
    stateCandidate(entry, position) {
        // The state of the todo extension (a custom entry).
        if (entry.type === "custom") {
            if (entry.customType !== "rpiv-todo-state")
                return null;
            if (!this.isTaskDetails(entry.data))
                return null;
            return {
                source: "custom",
                position,
                at: entryTime(entry),
                state: {
                    tasks: entry.data.tasks.map((t) => ({ ...t })),
                    nextId: entry.data.nextId,
                },
            };
        }
        // The result of a call of the todo tool.
        if (entry.type !== "message")
            return null;
        const msg = entry.message;
        if (msg?.role !== "toolResult" || msg.toolName !== "todo")
            return null;
        if (!this.isTaskDetails(msg.details))
            return null;
        return {
            source: "tool",
            position,
            at: entryTime(entry),
            state: {
                tasks: msg.details.tasks.map((t) => ({ ...t })),
                nextId: msg.details.nextId,
            },
        };
    }
    /**
     * The history of the list: the state after every change.
     *
     * The branch holds the result of every call of the todo tool, so the
     * history is the list of those states in the order of the calls. A
     * branch that was compacted lost the early states, and the history is
     * then shorter: the reader falls back to the list alone.
     */
    async getHistory() {
        const entries = [];
        try {
            const branch = this.ctx.sessionManager.getBranch();
            for (const entry of branch) {
                const e = entry;
                // The state of the todo extension is a state of the list.
                if (e.type === "custom") {
                    if (e.customType === "rpiv-todo-state" && this.isTaskDetails(e.data)) {
                        entries.push({
                            items: e.data.tasks.map((task) => ({ ...task })),
                        });
                    }
                    continue;
                }
                if (e.type !== "message")
                    continue;
                const msg = e.message;
                if (msg?.role !== "toolResult" || msg.toolName !== "todo")
                    continue;
                if (!this.isTaskDetails(msg.details))
                    continue;
                entries.push({
                    items: msg.details.tasks.map((task) => ({ ...task })),
                });
            }
        }
        catch (err) {
            this._lastError = err instanceof Error ? err.message : String(err);
            return entries;
        }
        return entries;
    }
    async getSnapshot() {
        this._revision++;
        const state = this.getTodoState();
        // Return empty state if no todos yet (not an error - just empty)
        if (state === null) {
            return {
                items: [],
                sessionId: this.ctx.sessionManager.getSessionId() ?? "unknown",
                revision: this._revision,
                createdAt: new Date(),
            };
        }
        return {
            items: state.tasks,
            sessionId: this.ctx.sessionManager.getSessionId() ?? "unknown",
            revision: this._revision,
            createdAt: new Date(),
        };
    }
    async getByStatus(status) {
        const { items } = await this.getSnapshot();
        return items.filter((item) => item.status === status);
    }
    async getInProgress() {
        return this.getByStatus("in_progress");
    }
    async getPending() {
        return this.getByStatus("pending");
    }
    async getCompleted() {
        return this.getByStatus("completed");
    }
    async getReady() {
        const pending = await this.getPending();
        const all = (await this.getSnapshot()).items;
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return true;
            const blockedIds = new Set(item.blockedBy);
            return !all.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
    async getBlocked() {
        const pending = await this.getPending();
        const all = (await this.getSnapshot()).items;
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return false;
            const blockedIds = new Set(item.blockedBy);
            return all.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
}
/**
 * Provider that reports Pi todo extension is not available
 */
class PiUnavailableTodoProvider {
    async availability() {
        return {
            available: false,
            error: "Pi session manager not available. Todo state is not accessible.",
            provider: "pi-todo",
        };
    }
    async getSnapshot() {
        throw new Error("Pi todo extension is not available");
    }
    async getByStatus(_status) {
        return [];
    }
    async getHistory() {
        return [];
    }
    async getInProgress() {
        return [];
    }
    async getPending() {
        return [];
    }
    async getCompleted() {
        return [];
    }
    async getReady() {
        return [];
    }
    async getBlocked() {
        return [];
    }
}
/**
 * Provider that reports Pi todo extension is not available
 */
//# sourceMappingURL=todo-provider.js.map
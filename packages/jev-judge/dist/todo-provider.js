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
        return newItem;
    }
    setStatus(id, status) {
        const item = this.items.find((i) => i.id === id);
        if (item) {
            item.status = status;
        }
    }
    clear() {
        this.items = [];
        this._revision++;
    }
}
/**
 * Create a todo provider that reads from rpiv-todo state via session branch
 */
export function createTodoProvider(pi) {
    if (pi && "sessionManager" in pi) {
        return new PiTodoProvider(pi);
    }
    return new PiUnavailableTodoProvider();
}
/**
 * Provider that reads rpiv-todo state from session branch
 * Replicates rpiv-todo's replayFromBranch logic to access todo state
 */
class PiTodoProvider {
    pi;
    _revision = 0;
    constructor(pi) {
        this.pi = pi;
    }
    async availability() {
        if (!this.pi.sessionManager) {
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
     */
    getTodoState() {
        let fromEntries;
        let fromToolResults;
        try {
            for (const entry of this.pi.sessionManager.getBranch()) {
                const e = entry;
                // Priority 1: rpiv-todo-state custom entries
                if (e.type === "custom") {
                    if (e.customType === "rpiv-todo-state" && this.isTaskDetails(e.data)) {
                        fromEntries = { tasks: e.data.tasks.map(t => ({ ...t })), nextId: e.data.nextId };
                    }
                    continue;
                }
                // Priority 2: toolResult entries with toolName === "todo"
                if (e.type !== "message")
                    continue;
                const msg = e.message;
                if (msg?.role !== "toolResult" || msg.toolName !== "todo")
                    continue;
                if (!this.isTaskDetails(msg.details))
                    continue;
                fromToolResults = { tasks: msg.details.tasks.map(t => ({ ...t })), nextId: msg.details.nextId };
            }
        }
        catch (err) {
            // Fall through to EMPTY_STATE on error
        }
        // Prefer custom entries (more authoritative), fall back to tool results
        return fromEntries ?? fromToolResults ?? { tasks: [], nextId: 1 };
    }
    async getSnapshot() {
        this._revision++;
        const state = this.getTodoState();
        return {
            items: state.tasks,
            sessionId: this.pi.sessionManager.getSessionId() ?? "unknown",
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
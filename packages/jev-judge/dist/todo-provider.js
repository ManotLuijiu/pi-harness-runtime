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
 * Create a todo provider based on available tools
 */
export function createTodoProvider(pi) {
    // For now, return mock provider
    // TODO: Integrate with actual Pi todo extension when available
    return new MockTodoProvider();
}
//# sourceMappingURL=todo-provider.js.map
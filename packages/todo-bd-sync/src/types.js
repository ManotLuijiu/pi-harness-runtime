/**
 * Types for todo-bd-sync
 * Two-way sync between rpiv-todo overlay and bd issue tracker
 */
// Registry of ID mappings
export class IdMappingRegistry {
    mappings = new Map(); // todoId -> mapping
    bdMappings = new Map(); // bdId -> todoId
    set(todoId, bdId) {
        const now = Date.now();
        const mapping = {
            todoId,
            bdId,
            createdAt: now,
            lastSync: now,
        };
        this.mappings.set(todoId, mapping);
        this.bdMappings.set(bdId, todoId);
    }
    getByTodoId(todoId) {
        return this.mappings.get(todoId);
    }
    getByBdId(bdId) {
        const todoId = this.bdMappings.get(bdId);
        return todoId !== undefined ? this.mappings.get(todoId) : undefined;
    }
    hasTodoId(todoId) {
        return this.mappings.has(todoId);
    }
    hasBdId(bdId) {
        return this.bdMappings.has(bdId);
    }
    updateLastSync(todoId) {
        const mapping = this.mappings.get(todoId);
        if (mapping) {
            mapping.lastSync = Date.now();
        }
    }
    delete(todoId) {
        const mapping = this.mappings.get(todoId);
        if (mapping) {
            this.bdMappings.delete(mapping.bdId);
            this.mappings.delete(todoId);
        }
    }
    getAll() {
        return Array.from(this.mappings.values());
    }
    clear() {
        this.mappings.clear();
        this.bdMappings.clear();
    }
}
// Status mapping between todo and bd
export const STATUS_MAP = {
    pending: "open",
    in_progress: "in_progress",
    completed: "closed",
    deleted: "closed",
};
export const BD_STATUS_MAP = {
    open: "pending",
    in_progress: "in_progress",
    closed: "completed",
    blocked: "pending",
};

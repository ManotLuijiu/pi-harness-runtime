/**
 * Connection Registry
 *
 * Scopes connections by environment/context.
 * Tracks active connections and their state.
 */
/**
 * Connection Registry
 *
 * Manages multiple connections by ID.
 * Connections persist even after disconnect (for reconnection).
 */
export class ConnectionRegistry {
    connections = new Map();
    onChange;
    constructor(onChange) {
        this.onChange = onChange;
    }
    /**
     * Register a new connection
     */
    register(id, supervisor, metadata) {
        const entry = {
            id,
            supervisor,
            metadata,
            createdAt: new Date(),
        };
        this.connections.set(id, entry);
        this.notifyChange();
        return entry;
    }
    /**
     * Unregister a connection
     */
    unregister(id) {
        const entry = this.connections.get(id);
        if (entry) {
            entry.supervisor.disconnect().catch(() => { });
            this.connections.delete(id);
            this.notifyChange();
            return true;
        }
        return false;
    }
    /**
     * Get a connection by ID
     */
    get(id) {
        return this.connections.get(id);
    }
    /**
     * Get all connections
     */
    list() {
        return Array.from(this.connections.values());
    }
    /**
     * Get connections by state
     */
    listByState(state) {
        return this.list().filter(e => e.supervisor.getState() === state);
    }
    /**
     * Update connection metadata
     */
    updateMetadata(id, metadata) {
        const entry = this.connections.get(id);
        if (entry) {
            entry.metadata = { ...entry.metadata, ...metadata };
            this.notifyChange();
            return true;
        }
        return false;
    }
    /**
     * Update last connected timestamp
     */
    touch(id) {
        const entry = this.connections.get(id);
        if (entry) {
            entry.lastConnectedAt = new Date();
            this.notifyChange();
            return true;
        }
        return false;
    }
    /**
     * Clear all connections
     */
    async clear() {
        const promises = this.list().map(e => e.supervisor.disconnect());
        await Promise.allSettled(promises);
        this.connections.clear();
        this.notifyChange();
    }
    /**
     * Get count of connections
     */
    size() {
        return this.connections.size;
    }
    /**
     * Check if connection exists
     */
    has(id) {
        return this.connections.has(id);
    }
    /**
     * Notify change listeners
     */
    notifyChange() {
        if (this.onChange) {
            this.onChange(this.list());
        }
    }
}

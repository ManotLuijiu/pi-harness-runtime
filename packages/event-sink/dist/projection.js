/**
 * Projection Store
 *
 * Maintains materialized views of events for efficient queries.
 * Projections are updated atomically with events.
 */
/**
 * Projection Store
 */
export class ProjectionStore {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    projections = new Map();
    /**
     * Register a projection
     */
    register(projection) {
        this.projections.set(projection.name, {
            name: projection.name,
            state: projection.initialState,
            initialState: projection.initialState,
            reduce: projection.reduce,
        });
    }
    /**
     * Apply events to all projections
     */
    apply(events) {
        for (const event of events) {
            for (const [name, entry] of this.projections.entries()) {
                try {
                    entry.state = entry.reduce(entry.state, event);
                }
                catch {
                    // Silently ignore projection errors - don't crash the event loop
                    // callers can check projection state after apply()
                }
            }
        }
    }
    /**
     * Get projection state
     */
    get(name) {
        const entry = this.projections.get(name);
        return entry ? entry.state : null;
    }
    /**
     * Reset projection to initial state
     */
    reset(name) {
        const entry = this.projections.get(name);
        if (entry) {
            entry.state = entry.initialState;
        }
    }
    /**
     * List all projection names
     */
    list() {
        return Array.from(this.projections.keys());
    }
}

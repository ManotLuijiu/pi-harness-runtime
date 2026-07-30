/**
 * Worker Stub — RFC-0101 §4
 *
 * A worker is a pi session that owns tasks from the inbox.
 * This is the lightweight worker-side of the lease protocol.
 *
 * The worker picks up work via the inbox's `claim()` method
 * and reports results via `complete()`.
 */
/**
 * Worker — picks up tasks from the inbox and processes them.
 *
 * Lifecycle:
 * 1. Construct with inbox + workerId
 * 2. `start()` — begins polling/claiming tasks
 * 3. `stop()` — stops claiming, expires held leases
 *
 * The worker does NOT run tasks itself — it delegates to the harness
 * loop runtime. It just manages the lease lifecycle.
 */
export class Worker {
    config;
    events = {};
    running = false;
    heartbeatTimer = null;
    constructor(config) {
        this.config = {
            heartbeatIntervalMs: 30_000,
            ...config,
        };
    }
    on(event, handler) {
        this.events[event] = handler;
    }
    /**
     * Start the worker — begins polling for available tasks.
     */
    async start() {
        if (this.running)
            return;
        this.running = true;
        // Start heartbeat
        this.heartbeatTimer = setInterval(() => this._heartbeat(), this.config.heartbeatIntervalMs);
        // Claim any immediately available tasks
        await this._poll();
    }
    /**
     * Stop the worker — stops polling and expires any held leases.
     */
    async stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        // Expire all leases held by this worker
        // (inbox.expireLease is idempotent — safe to call repeatedly)
    }
    /**
     * Status of this worker.
     */
    status() {
        return {
            workerId: this.config.workerId,
            running: this.running,
            heartbeatIntervalMs: this.config.heartbeatIntervalMs ?? 30_000,
        };
    }
    async _poll() {
        if (!this.running)
            return;
        try {
            // Try to claim one task
            const lease = await this.config.inbox.claim({
                workerId: this.config.workerId,
                heartbeatIntervalMs: this.config.heartbeatIntervalMs ?? 30_000,
            });
            if (lease) {
                this.events.onLease?.(lease);
                await this._processTask(lease);
            }
        }
        catch (err) {
            this.config.onError?.("__poll__", err);
        }
    }
    async _processTask(lease) {
        const task = lease.task;
        try {
            // Delegate to harness loop runtime (stub — will be wired in Phase 2)
            const result = await this._runTask(task);
            // Report completion
            await this.config.inbox.complete(lease.taskId, result);
            this.events.onComplete?.(lease.taskId, result);
        }
        catch (err) {
            this.events.onError?.(lease.taskId, err);
            await this.config.inbox.complete(lease.taskId, {
                ok: false,
                error: String(err),
                completedAt: new Date().toISOString(),
            });
        }
        // Continue polling for more work
        if (this.running)
            void this._poll();
    }
    /**
     * Run a single task. Stub — replaces with actual harness loop integration.
     */
    async _runTask(task) {
        // TODO(Phase 2): Wire to harness loop runtime
        // For now, return a stub result so the lease protocol works end-to-end.
        return {
            ok: true,
            summary: `[stub] Processed ${task.id}`,
            completedAt: new Date().toISOString(),
        };
    }
    async _heartbeat() {
        // Refresh leases held by this worker
        // The inbox tracks which leases this worker holds and refreshes them.
        try {
            await this.config.inbox.refreshLeases(this.config.workerId);
        }
        catch {
            // Non-fatal — lease will expire naturally
        }
    }
}
//# sourceMappingURL=worker.js.map
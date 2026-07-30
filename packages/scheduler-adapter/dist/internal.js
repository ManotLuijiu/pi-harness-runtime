/**
 * Scheduler Adapter — Internal (In-Process) Backend
 * RFC-0101 §6
 *
 * Uses in-process setTimeout / setInterval for scheduling.
 * Useful for testing, local development, and environments where
 * systemd/cron are not available.
 */
export class InternalAdapter {
    name = "internal";
    tasks = new Map();
    handlers = new Map();
    async install() {
        // Nothing to install for in-process scheduling
    }
    async healthCheck() {
        return { healthy: true };
    }
    /**
     * Register a task handler before scheduling.
     * The adapter calls `handler(task)` when the task fires.
     */
    setHandler(handler) {
        this.handlers.set("default", handler);
    }
    async schedule(task) {
        if (this.tasks.has(task.id)) {
            await this.unschedule(task.id);
        }
        const handler = this.handlers.get("default");
        if (!handler) {
            throw new Error("[InternalAdapter] No task handler registered. Call setHandler() first.");
        }
        if (!task.enabled)
            return; // skip disabled tasks
        let delayMs;
        if (task.schedule.kind === "once") {
            delayMs = new Date(task.schedule.at).getTime() - Date.now();
        }
        else if (task.schedule.kind === "interval") {
            delayMs = task.schedule.intervalMs;
        }
        else {
            // cron — resolve to next occurrence (simplified: 1h from now)
            delayMs = 3_600_000;
        }
        if (delayMs <= 0)
            delayMs = 1000;
        const tick = () => {
            const t = this.tasks.get(task.id);
            if (!t)
                return;
            handler(task);
            // Re-schedule if interval
            if (task.schedule.kind === "interval") {
                t.timerId = setTimeout(tick, task.schedule.intervalMs);
            }
        };
        const timerId = setTimeout(tick, delayMs);
        this.tasks.set(task.id, { task, timerId, createdAt: new Date() });
    }
    async unschedule(taskId) {
        const t = this.tasks.get(taskId);
        if (t) {
            clearTimeout(t.timerId);
            this.tasks.delete(taskId);
        }
    }
    async listScheduled() {
        return Array.from(this.tasks.values()).map((t) => t.task);
    }
    /** Fire a task immediately (useful for testing). */
    fireNow(taskId) {
        const t = this.tasks.get(taskId);
        if (!t)
            return;
        const handler = this.handlers.get("default");
        if (handler)
            handler(t.task);
    }
}
//# sourceMappingURL=internal.js.map
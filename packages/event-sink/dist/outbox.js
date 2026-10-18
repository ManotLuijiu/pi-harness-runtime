/**
 * Outbox Worker
 *
 * Processes outbox entries after events are committed.
 * Side effects are performed asynchronously.
 */
/**
 * Outbox Worker
 *
 * Processes pending outbox entries and executes their effects.
 */
export class OutboxWorker {
    maxRetries;
    retryDelay;
    handlers = new Map();
    running = false;
    interval;
    constructor(options = {}) {
        this.maxRetries = options.maxRetries ?? 3;
        this.retryDelay = options.retryDelay ?? 1000;
        if (options.handlers) {
            for (const [name, handler] of Object.entries(options.handlers)) {
                this.handlers.set(name, handler);
            }
        }
    }
    /**
     * Register an effect handler
     */
    register(effect, handler) {
        this.handlers.set(effect, handler);
    }
    /**
     * Start processing outbox
     */
    start(getPending, updateStatus, pollInterval = 1000) {
        if (this.running)
            return;
        this.running = true;
        this.interval = setInterval(async () => {
            if (!this.running)
                return;
            try {
                const entries = await getPending();
                for (const entry of entries) {
                    if (!this.running)
                        break;
                    if (entry.attempts >= this.maxRetries) {
                        await updateStatus(entry.id, 'failed', 'Max retries exceeded');
                        continue;
                    }
                    const handler = this.handlers.get(entry.effect);
                    if (!handler) {
                        await updateStatus(entry.id, 'failed', `No handler for effect: ${entry.effect}`);
                        continue;
                    }
                    try {
                        await updateStatus(entry.id, 'processing');
                        await handler(entry.payload);
                        await updateStatus(entry.id, 'completed');
                    }
                    catch (error) {
                        await updateStatus(entry.id, 'failed', String(error));
                    }
                }
            }
            catch (error) {
                console.error('[OutboxWorker] Error processing outbox:', error);
            }
        }, pollInterval);
    }
    /**
     * Stop processing
     */
    stop() {
        this.running = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
    /**
     * Check if running
     */
    isRunning() {
        return this.running;
    }
}

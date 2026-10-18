/**
 * Outbox Worker
 *
 * Processes outbox entries after events are committed.
 * Side effects are performed asynchronously.
 */
import type { OutboxEntry } from './sink.js';
/**
 * Effect handler function
 */
export type EffectHandler = (payload: unknown) => Promise<void>;
/**
 * Outbox Worker options
 */
export interface OutboxWorkerOptions {
    /** Maximum retry attempts */
    maxRetries?: number;
    /** Retry delay in ms */
    retryDelay?: number;
    /** Effect handlers */
    handlers?: Record<string, EffectHandler>;
}
/**
 * Outbox Worker
 *
 * Processes pending outbox entries and executes their effects.
 */
export declare class OutboxWorker {
    private maxRetries;
    private retryDelay;
    private handlers;
    private running;
    private interval?;
    constructor(options?: OutboxWorkerOptions);
    /**
     * Register an effect handler
     */
    register(effect: string, handler: EffectHandler): void;
    /**
     * Start processing outbox
     */
    start(getPending: () => Promise<OutboxEntry[]>, updateStatus: (id: string, status: OutboxEntry['status'], error?: string) => Promise<void>, pollInterval?: number): void;
    /**
     * Stop processing
     */
    stop(): void;
    /**
     * Check if running
     */
    isRunning(): boolean;
}

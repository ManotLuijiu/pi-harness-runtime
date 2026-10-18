/**
 * Connection Supervisor
 *
 * Inspired by T3Code's connection supervisor:
 * - Jittered exponential backoff for reconnection
 * - Resets delay after successful connection
 * - Cap at maxDelay to prevent thundering herd
 */
import { DEFAULT_CONNECTION_OPTIONS } from './types.js';
/**
 * Sleep utility - cross-platform
 */
function sleep(ms) {
    // SAFETY: globalThis is always available in JS environments
    // We assert it has setTimeout which is true for browsers and Node.js
    const global = globalThis;
    return new Promise(resolve => {
        const tid = global.setTimeout(resolve, ms);
        // Prevent unref warning in Node.js
        if (typeof tid.unref === 'function') {
            tid.unref?.();
        }
    });
}
/**
 * Connection Supervisor
 *
 * Manages transport connection with automatic reconnection using
 * jittered exponential backoff.
 */
export class ConnectionSupervisor {
    transport;
    delay;
    maxDelay;
    maxRetries;
    jitter;
    retries = 0;
    state = 'idle';
    stopping = false;
    onConnected;
    onDisconnected;
    onError;
    onRetry;
    constructor(options) {
        const opts = { ...DEFAULT_CONNECTION_OPTIONS, ...options };
        this.transport = options.transport;
        this.delay = opts.initialDelay ?? 1000;
        this.maxDelay = opts.maxDelay ?? 5 * 60 * 1000;
        this.maxRetries = opts.maxRetries ?? 0;
        this.jitter = opts.jitter ?? true;
        this.onConnected = options.onConnected;
        this.onDisconnected = options.onDisconnected;
        this.onError = options.onError;
        this.onRetry = options.onRetry;
    }
    /**
     * Current connection state
     */
    getState() {
        return this.state;
    }
    /**
     * Number of retries attempted
     */
    getRetries() {
        return this.retries;
    }
    /**
     * Start the connection
     */
    async connect() {
        if (this.state === 'connected' || this.state === 'connecting') {
            return;
        }
        this.stopping = false;
        this.state = 'connecting';
        try {
            await this.transport.open();
            this.onConnected?.();
            this.state = 'connected';
            this.delay = this.getInitialDelay(); // Reset on success
            this.retries = 0;
        }
        catch (error) {
            this.handleConnectionError(error);
        }
    }
    /**
     * Stop the connection
     */
    async disconnect() {
        this.stopping = true;
        this.state = 'stopped';
        try {
            await this.transport.close();
        }
        catch {
            // Ignore close errors
        }
        this.onDisconnected?.();
    }
    /**
     * Force reconnection
     */
    async reconnect() {
        if (this.state === 'reconnecting') {
            return;
        }
        this.state = 'reconnecting';
        await this.attemptConnection();
    }
    /**
     * Handle connection error with backoff
     */
    async handleConnectionError(error) {
        this.onError?.(error);
        if (this.stopping) {
            this.state = 'stopped';
            return;
        }
        this.state = 'reconnecting';
        await this.attemptConnection();
    }
    /**
     * Attempt connection with backoff
     */
    async attemptConnection() {
        while (!this.stopping) {
            this.retries++;
            if (this.maxRetries > 0 && this.retries > this.maxRetries) {
                this.state = 'error';
                this.onError?.(new Error(`Max retries (${this.maxRetries}) exceeded`));
                return;
            }
            // Calculate delay with optional jitter
            const actualDelay = this.jitter
                ? this.delay + Math.random() * this.delay * 0.3 // Up to 30% jitter
                : this.delay;
            this.onRetry?.(this.retries, actualDelay);
            await sleep(actualDelay);
            if (this.stopping) {
                this.state = 'stopped';
                return;
            }
            try {
                await this.transport.open();
                this.onConnected?.();
                this.state = 'connected';
                this.delay = this.getInitialDelay(); // Reset on success
                this.retries = 0;
                return;
            }
            catch (error) {
                this.onError?.(error);
                // Exponential backoff
                this.delay = Math.min(this.delay * 2, this.maxDelay);
            }
        }
        this.state = 'stopped';
    }
    /**
     * Get initial delay (allows override)
     */
    getInitialDelay() {
        return this.transport.isConnected()
            ? this.delay
            : 1000;
    }
}

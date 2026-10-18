/**
 * Connection Supervisor
 *
 * Inspired by T3Code's connection supervisor:
 * - Jittered exponential backoff for reconnection
 * - Resets delay after successful connection
 * - Cap at maxDelay to prevent thundering herd
 */
import type { EventEmitter } from './types.js';
/**
 * Connection Supervisor options
 */
export interface SupervisorOptions {
    /** Transport to manage */
    transport: EventEmitter & {
        open(): Promise<void>;
        close(): Promise<void>;
        isConnected(): boolean;
    };
    /** Initial retry delay in ms */
    initialDelay?: number;
    /** Maximum retry delay in ms */
    maxDelay?: number;
    /** Maximum retries (0 = infinite) */
    maxRetries?: number;
    /** Enable jitter */
    jitter?: boolean;
    /** Callback when connected */
    onConnected?: () => void;
    /** Callback when disconnected */
    onDisconnected?: () => void;
    /** Callback on error */
    onError?: (error: Error) => void;
    /** Callback on retry attempt */
    onRetry?: (attempt: number, delay: number) => void;
}
/**
 * Connection Supervisor
 *
 * Manages transport connection with automatic reconnection using
 * jittered exponential backoff.
 */
export declare class ConnectionSupervisor {
    private transport;
    private delay;
    private maxDelay;
    private maxRetries;
    private jitter;
    private retries;
    private state;
    private stopping;
    private onConnected?;
    private onDisconnected?;
    private onError?;
    private onRetry?;
    constructor(options: SupervisorOptions);
    /**
     * Current connection state
     */
    getState(): "connected" | "connecting" | "error" | "idle" | "reconnecting" | "stopped";
    /**
     * Number of retries attempted
     */
    getRetries(): number;
    /**
     * Start the connection
     */
    connect(): Promise<void>;
    /**
     * Stop the connection
     */
    disconnect(): Promise<void>;
    /**
     * Force reconnection
     */
    reconnect(): Promise<void>;
    /**
     * Handle connection error with backoff
     */
    private handleConnectionError;
    /**
     * Attempt connection with backoff
     */
    private attemptConnection;
    /**
     * Get initial delay (allows override)
     */
    protected getInitialDelay(): number;
}

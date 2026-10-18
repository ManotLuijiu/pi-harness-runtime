/**
 * Connection types
 *
 * Note: Uses minimal EventEmitter-like interface to avoid Node.js dependency.
 * Implementations can swap in Node's EventEmitter or use any compatible event system.
 */
/**
 * Minimal event emitter interface
 */
export interface EventEmitter {
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
    once(event: string, listener: (...args: unknown[]) => void): void;
    removeAllListeners(event?: string): void;
}
/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
/**
 * Connection error
 */
export interface ConnectionError extends Error {
    code?: string;
    recoverable?: boolean;
}
/**
 * Transport interface
 */
export interface Transport {
    /** Open the connection */
    open(): Promise<void>;
    /** Close the connection */
    close(): Promise<void>;
    /** Send a message */
    send(data: unknown): Promise<void>;
    /** Check if connected */
    isConnected(): boolean;
    /** Event emitter for connection events */
    events: EventEmitter;
}
/**
 * Transport events
 */
export interface TransportEvents {
    'open': () => void;
    'close': () => void;
    'error': (error: Error) => void;
    'message': (data: unknown) => void;
}
/**
 * Connection options
 */
export interface ConnectionOptions {
    /** Initial retry delay in ms */
    initialDelay?: number;
    /** Maximum retry delay in ms */
    maxDelay?: number;
    /** Maximum number of retries (0 = infinite) */
    maxRetries?: number;
    /** Enable jitter (recommended) */
    jitter?: boolean;
    /** Enable verbose logging */
    verbose?: boolean;
}
/**
 * Default connection options
 */
export declare const DEFAULT_CONNECTION_OPTIONS: Required<ConnectionOptions>;

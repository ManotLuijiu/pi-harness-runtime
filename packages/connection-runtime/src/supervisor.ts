/**
 * Connection Supervisor
 * 
 * Inspired by T3Code's connection supervisor:
 * - Jittered exponential backoff for reconnection
 * - Resets delay after successful connection
 * - Cap at maxDelay to prevent thundering herd
 */

import type { EventEmitter } from './types.js';
import { DEFAULT_CONNECTION_OPTIONS } from './types.js';

/**
 * Sleep utility - cross-platform
 */
function sleep(ms: number): Promise<void> {
  // SAFETY: globalThis is always available in JS environments
  // We assert it has setTimeout which is true for browsers and Node.js
  const global = globalThis as unknown as {
    setTimeout: (fn: () => void, ms: number) => { unref?: () => void }
  };
  return new Promise(resolve => {
    const tid = global.setTimeout(resolve, ms);
    // Prevent unref warning in Node.js
    if (typeof tid.unref === 'function') {
      tid.unref?.();
    }
  });
}

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
export class ConnectionSupervisor {
  private transport: SupervisorOptions['transport'];
  private delay: number;
  private maxDelay: number;
  private maxRetries: number;
  private jitter: boolean;
  private retries = 0;
  private state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped' | 'error' = 'idle';
  private stopping = false;
  private onConnected?: () => void;
  private onDisconnected?: () => void;
  private onError?: (error: Error) => void;
  private onRetry?: (attempt: number, delay: number) => void;

  constructor(options: SupervisorOptions) {
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
  async connect(): Promise<void> {
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
    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  /**
   * Stop the connection
   */
  async disconnect(): Promise<void> {
    this.stopping = true;
    this.state = 'stopped';
    
    try {
      await this.transport.close();
    } catch {
      // Ignore close errors
    }
    
    this.onDisconnected?.();
  }

  /**
   * Force reconnection
   */
  async reconnect(): Promise<void> {
    if (this.state === 'reconnecting') {
      return;
    }

    this.state = 'reconnecting';
    await this.attemptConnection();
  }

  /**
   * Handle connection error with backoff
   */
  private async handleConnectionError(error: Error): Promise<void> {
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
  private async attemptConnection(): Promise<void> {
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
      } catch (error) {
        this.onError?.(error as Error);
        
        // Exponential backoff
        this.delay = Math.min(this.delay * 2, this.maxDelay);
      }
    }

    this.state = 'stopped';
  }

  /**
   * Get initial delay (allows override)
   */
  protected getInitialDelay(): number {
    return this.transport.isConnected() 
      ? this.delay 
      : 1000;
  }
}

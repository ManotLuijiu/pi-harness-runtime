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
export class OutboxWorker {
  private maxRetries: number;
  private retryDelay: number;
  private handlers: Map<string, EffectHandler> = new Map();
  private running = false;
  private interval?: ReturnType<typeof setInterval>;

  constructor(options: OutboxWorkerOptions = {}) {
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
  register(effect: string, handler: EffectHandler): void {
    this.handlers.set(effect, handler);
  }

  /**
   * Start processing outbox
   */
  start(
    getPending: () => Promise<OutboxEntry[]>,
    updateStatus: (id: string, status: OutboxEntry['status'], error?: string) => Promise<void>,
    pollInterval = 1000,
  ): void {
    if (this.running) return;
    this.running = true;

    this.interval = setInterval(async () => {
      if (!this.running) return;
      
      try {
        const entries = await getPending();
        
        for (const entry of entries) {
          if (!this.running) break;
          
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
          } catch (error) {
            await updateStatus(entry.id, 'failed', String(error));
          }
        }
      } catch (error) {
        console.error('[OutboxWorker] Error processing outbox:', error);
      }
    }, pollInterval);
  }

  /**
   * Stop processing
   */
  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }
}

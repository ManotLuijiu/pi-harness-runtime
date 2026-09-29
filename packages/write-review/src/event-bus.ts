/**
 * Ping-Pong Event Bus
 * 
 * Lightweight event bus for two-agent coordination.
 * Watches blackboard status.json for state changes.
 * Emits events and notifies agents via ExtensionAPI.
 * 
 * NO AI NEEDED - deterministic file watching + state machine.
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Ping-Pong Events
 */
export enum PingPongEvent {
  SESSION_STARTED = "session_started",
  WRITING_STARTED = "writing_started",
  WRITER_DONE = "writer_done",
  REVIEW_NEEDED = "review_needed",
  REVIEW_STARTED = "review_started",
  REVIEW_COMPLETE = "review_complete",
  APPROVED = "approved",
  CHANGES_REQUESTED = "changes_requested",
  BLOCKED = "blocked",
  SESSION_ENDED = "session_ended",
}

/**
 * Event payload
 */
export interface PingPongEventPayload {
  event: PingPongEvent;
  phase: string;
  iteration: number;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Event listener callback
 */
export type PingPongListener = (payload: PingPongEventPayload) => void | Promise<void>;

/**
 * Phase to event mapping
 */
const PHASE_TO_EVENT: Record<string, PingPongEvent> = {
  idle: PingPongEvent.SESSION_STARTED,
  writing: PingPongEvent.WRITING_STARTED,
  pending_review: PingPongEvent.REVIEW_NEEDED,
  reviewing: PingPongEvent.REVIEW_STARTED,
  approved: PingPongEvent.APPROVED,
  blocked: PingPongEvent.BLOCKED,
  changes_requested: PingPongEvent.CHANGES_REQUESTED,
};

/**
 * Simple Event Bus for ping-pong coordination
 */
export class PingPongEventBus {
  private listeners: Map<PingPongEvent, Set<PingPongListener>> = new Map();
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  private lastStatusHash: string | null = null;
  private pi: ExtensionAPI | null = null;
  private projectPath: string | null = null;

  /**
   * Register an event listener
   */
  on(event: PingPongEvent, listener: PingPongListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /**
   * Register a listener for all events
   */
  onAny(listener: PingPongListener): () => void {
    const wrappedListener = (payload: PingPongEventPayload) => {
      return listener(payload);
    };
    
    // Listen to all events
    for (const event of Object.values(PingPongEvent)) {
      this.on(event, wrappedListener);
    }
    
    // Return unsubscribe for all
    return () => {
      for (const event of Object.values(PingPongEvent)) {
        this.listeners.get(event)?.delete(wrappedListener);
      }
    };
  }

  /**
   * Emit an event
   */
  private emit(event: PingPongEvent, payload: Omit<PingPongEventPayload, "event">): void {
    const fullPayload: PingPongEventPayload = {
      event,
      ...payload,
    };

    // Call specific listeners
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          const result = listener(fullPayload);
          if (result instanceof Promise) {
            result.catch((err) => {
              console.error(`[PingPong] Listener error:`, err);
            });
          }
        } catch (err) {
          console.error(`[PingPong] Listener error:`, err);
        }
      }
    }

    // Notify via ExtensionAPI if available
    if (this.pi) {
      this.notifyAgents(fullPayload);
    }

    // Log for debugging
    console.error(
      `[PingPong] Event: ${event}, phase=${payload.phase}, iteration=${payload.iteration}`
    );
  }

  /**
   * Notify agents via ExtensionAPI
   */
  private notifyAgents(payload: PingPongEventPayload): void {
    if (!this.pi) return;

    const { event, phase, iteration } = payload;

    // Map events to user-facing notifications
    const messages: Record<PingPongEvent, string> = {
      [PingPongEvent.SESSION_STARTED]: `Write-review session started`,
      [PingPongEvent.WRITING_STARTED]: `Writer agent started (iteration ${iteration})`,
      [PingPongEvent.WRITER_DONE]: `Writer done! Code ready for review`,
      [PingPongEvent.REVIEW_NEEDED]: `Review needed - iteration ${iteration}`,
      [PingPongEvent.REVIEW_STARTED]: `Reviewer agent started`,
      [PingPongEvent.REVIEW_COMPLETE]: `Review complete - verdict: ${phase}`,
      [PingPongEvent.APPROVED]: `APPROVED! Code ready to build/commit`,
      [PingPongEvent.CHANGES_REQUESTED]: `Changes requested - iteration ${iteration}`,
      [PingPongEvent.BLOCKED]: `BLOCKED - human intervention needed`,
      [PingPongEvent.SESSION_ENDED]: `Write-review session ended`,
    };

    const message = messages[event];
    if (message) {
      const level = event === PingPongEvent.APPROVED 
        ? "success" 
        : event === PingPongEvent.BLOCKED 
          ? "error" 
          : "info";
      
      // Use ui.notify if available on ExtensionContext
      try {
        // SAFETY: ExtensionAPI doesn't export ui type, we access it via dynamic lookup
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ui = (this.pi as any)?.ui;
        if (ui?.notify) {
          ui.notify(message, level);
        }
      } catch {
        // ExtensionAPI ui.notify not available
      }
    }
  }

  /**
   * Start watching a blackboard status.json
   */
  startWatching(blackboardPath: string): void {
    // Stop any existing watcher
    this.stopWatching();

    const statusPath = join(blackboardPath, "status.json");
    this.projectPath = blackboardPath.replace("/.write-review", "");

    if (!existsSync(statusPath)) {
      console.error(`[PingPong] status.json not found at ${statusPath}`);
      return;
    }

    // Read initial status
    this.readAndEmit(statusPath);

    // Watch for changes
    try {
      const watcher = watch(blackboardPath, { persistent: true }, (_eventType, filename) => {
        if (filename === "status.json") {
          this.readAndEmit(statusPath);
        }
      });

      this.watchers.set(statusPath, watcher);
      console.error(`[PingPong] Started watching ${blackboardPath}`);
    } catch (err) {
      console.error(`[PingPong] Failed to watch ${statusPath}:`, err);
    }
  }

  /**
   * Read status.json and emit events if changed
   */
  private readAndEmit(statusPath: string): void {
    try {
      const content = readFileSync(statusPath, "utf-8");
      const status = JSON.parse(content);

      // Check if status changed
      const statusHash = JSON.stringify({
        phase: status.phase,
        writerDone: status.writerDone,
        iteration: status.iteration,
        verdict: status.verdict,
      });

      if (statusHash === this.lastStatusHash) {
        return; // No change
      }

      const previousHash = this.lastStatusHash;
      this.lastStatusHash = statusHash;

      // Emit events based on phase transition
      const phase = status.phase as string;
      const iteration = status.iteration || 1;

      // Detect writer done (was false, now true)
      const wasWriterDone = previousHash ? previousHash.includes('"writerDone":true') : false;
      if (status.writerDone && !wasWriterDone) {
        this.emit(PingPongEvent.WRITER_DONE, {
          phase,
          iteration,
          timestamp: new Date().toISOString(),
          data: { writerMessage: status.writerMessage },
        });
      }

      // Emit phase event
      const event = PHASE_TO_EVENT[phase];
      if (event) {
        this.emit(event, {
          phase,
          iteration,
          timestamp: new Date().toISOString(),
          data: { verdict: status.verdict, verdictMessage: status.verdictMessage },
        });
      }

    } catch (err) {
      console.error(`[PingPong] Failed to read status.json:`, err);
    }
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      this.watchers.delete(path);
    }
    console.error(`[PingPong] Stopped watching`);
  }

  /**
   * Set ExtensionAPI for notifications
   */
  setExtensionAPI(pi: ExtensionAPI): void {
    this.pi = pi;
  }

  /**
   * Get current status hash
   */
  getLastStatusHash(): string | null {
    return this.lastStatusHash;
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.stopWatching();
    this.listeners.clear();
    this.pi = null;
  }
}

// Singleton instance
let globalEventBus: PingPongEventBus | null = null;

/**
 * Get global event bus instance
 */
export function getPingPongEventBus(): PingPongEventBus {
  if (!globalEventBus) {
    globalEventBus = new PingPongEventBus();
  }
  return globalEventBus;
}

/**
 * Create a new event bus instance
 */
export function createPingPongEventBus(): PingPongEventBus {
  return new PingPongEventBus();
}

/**
 * Helper: Check if status changed from previous
 */
export function hasStatusChanged(
  current: Record<string, unknown>,
  previous: string | null
): boolean {
  const currentHash = JSON.stringify({
    phase: current.phase,
    writerDone: current.writerDone,
    iteration: current.iteration,
    verdict: current.verdict,
  });

  return currentHash !== previous;
}

/**
 * Helper: Format event for logging
 */
export function formatPingPongEvent(event: PingPongEventPayload): string {
  return `[PingPong:${event.event}] phase=${event.phase}, iteration=${event.iteration}, time=${event.timestamp}`;
}

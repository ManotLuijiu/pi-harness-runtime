/**
 * Ping-Pong Event Bus
 *
 * Lightweight event bus for two-agent coordination.
 * Watches blackboard status.json for state changes.
 * Emits events and notifies agents via ExtensionAPI.
 *
 * NO AI NEEDED - deterministic file watching + state machine.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Ping-Pong Events
 */
export declare enum PingPongEvent {
    SESSION_STARTED = "session_started",
    WRITING_STARTED = "writing_started",
    WRITER_DONE = "writer_done",
    REVIEW_NEEDED = "review_needed",
    REVIEW_STARTED = "review_started",
    REVIEW_COMPLETE = "review_complete",
    APPROVED = "approved",
    CHANGES_REQUESTED = "changes_requested",
    BLOCKED = "blocked",
    SESSION_ENDED = "session_ended"
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
 * Simple Event Bus for ping-pong coordination
 */
export declare class PingPongEventBus {
    private listeners;
    private watchers;
    private lastStatusHash;
    private pi;
    private projectPath;
    /**
     * Register an event listener
     */
    on(event: PingPongEvent, listener: PingPongListener): () => void;
    /**
     * Register a listener for all events
     */
    onAny(listener: PingPongListener): () => void;
    /**
     * Emit an event
     */
    private emit;
    /**
     * Notify agents via ExtensionAPI
     */
    private notifyAgents;
    /**
     * Start watching a blackboard status.json
     */
    startWatching(blackboardPath: string): void;
    /**
     * Read status.json and emit events if changed
     */
    private readAndEmit;
    /**
     * Stop watching
     */
    stopWatching(): void;
    /**
     * Set ExtensionAPI for notifications
     */
    setExtensionAPI(pi: ExtensionAPI): void;
    /**
     * Get current status hash
     */
    getLastStatusHash(): string | null;
    /**
     * Clean up
     */
    destroy(): void;
}
/**
 * Get global event bus instance
 */
export declare function getPingPongEventBus(): PingPongEventBus;
/**
 * Create a new event bus instance
 */
export declare function createPingPongEventBus(): PingPongEventBus;
/**
 * Helper: Check if status changed from previous
 */
export declare function hasStatusChanged(current: Record<string, unknown>, previous: string | null): boolean;
/**
 * Helper: Format event for logging
 */
export declare function formatPingPongEvent(event: PingPongEventPayload): string;
//# sourceMappingURL=event-bus.d.ts.map
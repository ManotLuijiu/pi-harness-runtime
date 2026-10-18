/**
 * Event Sink - Atomic Event Sourcing
 *
 * Inspired by T3Code's orchestrator:
 * - Events + projections + outbox effects committed atomically
 * - Command acknowledgement = intent committed, not work finished
 */
/**
 * Event with metadata
 */
export interface StoredEvent {
    id: string;
    type: string;
    timestamp: string;
    workspaceId?: string;
    sessionId?: string;
    jobId?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    commandId?: string;
    sequence: number;
}
/**
 * Outbox entry for side effects
 */
export interface OutboxEntry {
    id: string;
    eventId: string;
    effect: string;
    payload: unknown;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    attempts: number;
    lastError?: string;
    createdAt: string;
    processedAt?: string;
}
/**
 * Event Sink options
 */
export interface EventSinkOptions {
    /** Database file path */
    dbPath: string;
    /** Called when events are committed */
    onEventsCommitted?: (events: StoredEvent[]) => void;
}
/**
 * Event Sink - Atomic event sourcing
 */
export declare class EventSink {
    private db;
    private sequence;
    private onEventsCommitted?;
    constructor(options: EventSinkOptions);
    /**
     * Commit events atomically with projections and outbox
     */
    commit<T extends StoredEvent>(events: T[], outboxEffects?: Array<{
        effect: string;
        payload: unknown;
    }>): Promise<{
        events: StoredEvent[];
        outbox: OutboxEntry[];
    }>;
    /**
     * Get events by filter
     */
    getEvents(filter?: {
        types?: string[];
        since?: number;
        until?: number;
        limit?: number;
    }): Promise<StoredEvent[]>;
    /**
     * Get pending outbox entries
     */
    getPendingOutbox(limit?: number): Promise<OutboxEntry[]>;
    /**
     * Update outbox entry status
     */
    updateOutboxStatus(id: string, status: OutboxEntry['status'], error?: string): Promise<void>;
}

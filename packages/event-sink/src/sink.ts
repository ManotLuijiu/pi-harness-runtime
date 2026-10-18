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
export class EventSink {
  private db: Map<string, unknown> = new Map();
  private sequence = 0;
  private onEventsCommitted?: (events: StoredEvent[]) => void;

  constructor(options: EventSinkOptions) {
    this.onEventsCommitted = options.onEventsCommitted;
  }

  /**
   * Commit events atomically with projections and outbox
   */
  async commit<T extends StoredEvent>(
    events: T[],
    outboxEffects: Array<{ effect: string; payload: unknown }> = [],
  ): Promise<{ events: StoredEvent[]; outbox: OutboxEntry[] }> {
    const committedEvents: StoredEvent[] = [];
    const outbox: OutboxEntry[] = [];

    // Assign sequence numbers atomically
    for (const event of events) {
      this.sequence++;
      const storedEvent: StoredEvent = {
        ...event,
        sequence: this.sequence,
      };
      committedEvents.push(storedEvent);
      
      // Store event
      this.db.set(`event:${storedEvent.id}`, storedEvent);
    }

    // Create outbox entries
    for (const effect of outboxEffects) {
      const entry: OutboxEntry = {
        id: crypto.randomUUID(),
        eventId: committedEvents[0]?.id || '',
        effect: effect.effect,
        payload: effect.payload,
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      outbox.push(entry);
      this.db.set(`outbox:${entry.id}`, entry);
    }

    // Notify listeners
    this.onEventsCommitted?.(committedEvents);

    return { events: committedEvents, outbox };
  }

  /**
   * Get events by filter
   */
  async getEvents(filter?: {
    types?: string[];
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<StoredEvent[]> {
    const events: StoredEvent[] = [];
    const limit = filter?.limit || 100;

    for (const [key, value] of this.db.entries()) {
      if (key.startsWith('event:') && typeof value === 'object') {
        const event = value as StoredEvent;
        
        if (filter?.types && !filter.types.includes(event.type)) continue;
        if (filter?.since && event.sequence <= filter.since) continue;
        if (filter?.until && event.sequence >= filter.until) continue;
        
        events.push(event);
        if (events.length >= limit) break;
      }
    }

    return events.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Get pending outbox entries
   */
  async getPendingOutbox(limit = 10): Promise<OutboxEntry[]> {
    const entries: OutboxEntry[] = [];

    for (const [key, value] of this.db.entries()) {
      if (key.startsWith('outbox:') && typeof value === 'object') {
        const entry = value as OutboxEntry;
        if (entry.status === 'pending' || entry.status === 'failed') {
          entries.push(entry);
          if (entries.length >= limit) break;
        }
      }
    }

    return entries;
  }

  /**
   * Update outbox entry status
   */
  async updateOutboxStatus(id: string, status: OutboxEntry['status'], error?: string): Promise<void> {
    const entry = this.db.get(`outbox:${id}`) as OutboxEntry | undefined;
    if (entry) {
      entry.status = status;
      entry.lastError = error;
      entry.attempts++;
      if (status === 'completed') {
        entry.processedAt = new Date().toISOString();
      }
    }
  }
}

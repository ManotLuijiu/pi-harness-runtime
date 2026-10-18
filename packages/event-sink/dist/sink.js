/**
 * Event Sink - Atomic Event Sourcing
 *
 * Inspired by T3Code's orchestrator:
 * - Events + projections + outbox effects committed atomically
 * - Command acknowledgement = intent committed, not work finished
 */
/**
 * Event Sink - Atomic event sourcing
 */
export class EventSink {
    db = new Map();
    sequence = 0;
    onEventsCommitted;
    constructor(options) {
        this.onEventsCommitted = options.onEventsCommitted;
    }
    /**
     * Commit events atomically with projections and outbox
     */
    async commit(events, outboxEffects = []) {
        const committedEvents = [];
        const outbox = [];
        // Assign sequence numbers atomically
        for (const event of events) {
            this.sequence++;
            const storedEvent = {
                ...event,
                sequence: this.sequence,
            };
            committedEvents.push(storedEvent);
            // Store event
            this.db.set(`event:${storedEvent.id}`, storedEvent);
        }
        // Create outbox entries
        for (const effect of outboxEffects) {
            const entry = {
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
    async getEvents(filter) {
        const events = [];
        const limit = filter?.limit || 100;
        for (const [key, value] of this.db.entries()) {
            if (key.startsWith('event:') && typeof value === 'object') {
                const event = value;
                if (filter?.types && !filter.types.includes(event.type))
                    continue;
                if (filter?.since && event.sequence <= filter.since)
                    continue;
                if (filter?.until && event.sequence >= filter.until)
                    continue;
                events.push(event);
                if (events.length >= limit)
                    break;
            }
        }
        return events.sort((a, b) => a.sequence - b.sequence);
    }
    /**
     * Get pending outbox entries
     */
    async getPendingOutbox(limit = 10) {
        const entries = [];
        for (const [key, value] of this.db.entries()) {
            if (key.startsWith('outbox:') && typeof value === 'object') {
                const entry = value;
                if (entry.status === 'pending' || entry.status === 'failed') {
                    entries.push(entry);
                    if (entries.length >= limit)
                        break;
                }
            }
        }
        return entries;
    }
    /**
     * Update outbox entry status
     */
    async updateOutboxStatus(id, status, error) {
        const entry = this.db.get(`outbox:${id}`);
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

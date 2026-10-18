/**
 * Event Sink - Atomic Event Sourcing
 * 
 * Inspired by T3Code's orchestrator event sourcing:
 * - Commands serialize to event log
 * - EventSink commits events + projections + outbox effects atomically
 * - EffectWorker performs side effects AFTER intent commits
 * - Command acknowledgement = intent committed, not work finished
 */

import type { EventCreate } from '@pi-harness/contracts';

export { EventSink } from './sink.js';
export { ProjectionStore } from './projection.js';
export { OutboxWorker } from './outbox.js';

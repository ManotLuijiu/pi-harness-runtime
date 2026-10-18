/**
 * Event schemas for pi-harness
 */

import { z } from 'zod';
import { Timestamp, UUID } from './base.js';

/**
 * Event types
 */
export const EventType = z.enum([
  'job.created',
  'job.started',
  'job.progress',
  'job.completed',
  'job.failed',
  'job.cancelled',
  'session.started',
  'session.ended',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'policy.acknowledged',
  'policy.updated',
  'tool.executed',
  'tool.failed',
  'checkpoint.created',
  'checkpoint.restored',
  'error.occurred',
]);

export type EventType = z.infer<typeof EventType>;

/**
 * Base event schema
 */
export const Event = z.object({
  id: UUID,
  type: EventType,
  timestamp: Timestamp,
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Event = z.infer<typeof Event>;

/**
 * Event creation input
 */
export const EventCreate = z.object({
  type: EventType,
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EventCreate = z.infer<typeof EventCreate>;

/**
 * Event filter for queries
 */
export const EventFilter = z.object({
  types: z.array(EventType).optional(),
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  since: Timestamp.optional(),
  until: Timestamp.optional(),
  limit: z.number().int().positive().max(1000).default(100),
  cursor: z.string().optional(),
});

export type EventFilter = z.infer<typeof EventFilter>;

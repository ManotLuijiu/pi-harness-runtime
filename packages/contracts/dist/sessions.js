/**
 * Session schemas for pi-harness
 */
import { z } from 'zod';
import { Timestamp, UUID, NonEmptyString } from './base.js';
/**
 * Session status
 */
export const SessionStatus = z.enum([
    'active',
    'idle',
    'suspended',
    'ended',
]);
/**
 * Session type
 */
export const SessionType = z.enum([
    'interactive',
    'batch',
    'background',
    'review',
]);
/**
 * Session definition
 */
export const Session = z.object({
    id: UUID,
    type: SessionType,
    status: SessionStatus,
    workspaceId: z.string(),
    provider: NonEmptyString,
    model: z.string().optional(),
    startedAt: Timestamp,
    endedAt: Timestamp.optional(),
    lastActivityAt: Timestamp.optional(),
    promptTokens: z.number().int().nonnegative().default(0),
    completionTokens: z.number().int().nonnegative().default(0),
    cost: z.number().nonnegative().default(0),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
/**
 * Session creation input
 */
export const SessionCreate = z.object({
    type: SessionType.default('interactive'),
    workspaceId: z.string(),
    provider: NonEmptyString,
    model: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
/**
 * Session update input
 */
export const SessionUpdate = z.object({
    status: SessionStatus.optional(),
    lastActivityAt: Timestamp.optional(),
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
/**
 * Session filter
 */
export const SessionFilter = z.object({
    workspaceId: z.string().optional(),
    type: SessionType.optional(),
    status: SessionStatus.optional(),
    since: Timestamp.optional(),
    until: Timestamp.optional(),
    limit: z.number().int().positive().max(100).default(50),
    cursor: z.string().optional(),
});
/**
 * Session list response
 */
export const SessionList = z.object({
    items: z.array(Session),
    nextCursor: z.string().optional(),
    total: z.number().optional(),
});

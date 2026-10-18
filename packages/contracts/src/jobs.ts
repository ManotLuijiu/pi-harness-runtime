/**
 * Job schemas for pi-harness
 */

import { z } from 'zod';
import { Timestamp, UUID, NonEmptyString } from './base.js';

/**
 * Job status
 */
export const JobStatus = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type JobStatus = z.infer<typeof JobStatus>;

/**
 * Job priority
 */
export const JobPriority = z.enum(['low', 'normal', 'high', 'urgent']);

export type JobPriority = z.infer<typeof JobPriority>;

/**
 * Job definition
 */
export const Job = z.object({
  id: UUID,
  type: NonEmptyString,
  status: JobStatus,
  priority: JobPriority.default('normal'),
  workspaceId: z.string(),
  sessionId: z.string().optional(),
  requirement: NonEmptyString,
  result: z.unknown().optional(),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).default(0),
  createdAt: Timestamp,
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Job = z.infer<typeof Job>;

/**
 * Job creation input
 */
export const JobCreate = z.object({
  type: NonEmptyString,
  priority: JobPriority.default('normal'),
  workspaceId: z.string(),
  sessionId: z.string().optional(),
  requirement: NonEmptyString,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type JobCreate = z.infer<typeof JobCreate>;

/**
 * Job update input
 */
export const JobUpdate = z.object({
  status: JobStatus.optional(),
  progress: z.number().min(0).max(100).optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type JobUpdate = z.infer<typeof JobUpdate>;

/**
 * Job filter
 */
export const JobFilter = z.object({
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  status: z.union([JobStatus, z.array(JobStatus)]).optional(),
  priority: JobPriority.optional(),
  since: Timestamp.optional(),
  until: Timestamp.optional(),
  limit: z.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export type JobFilter = z.infer<typeof JobFilter>;

/**
 * Job list response
 */
export const JobList = z.object({
  items: z.array(Job),
  nextCursor: z.string().optional(),
  total: z.number().optional(),
});

export type JobList = z.infer<typeof JobList>;

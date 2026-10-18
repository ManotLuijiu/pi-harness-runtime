/**
 * Approval schemas for pi-harness
 */

import { z } from 'zod';
import { Timestamp, UUID, NonEmptyString } from './base.js';

/**
 * Approval status
 */
export const ApprovalStatus = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
]);

export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/**
 * Approval type
 */
export const ApprovalType = z.enum([
  'tool_execution',
  'file_write',
  'file_delete',
  'command_execution',
  'network_request',
  'external_action',
]);

export type ApprovalType = z.infer<typeof ApprovalType>;

/**
 * Approval definition
 */
export const Approval = z.object({
  id: UUID,
  type: ApprovalType,
  status: ApprovalStatus.default('pending'),
  workspaceId: z.string(),
  sessionId: z.string(),
  jobId: z.string().optional(),
  tool: NonEmptyString.optional(),
  command: NonEmptyString.optional(),
  file: NonEmptyString.optional(),
  description: NonEmptyString,
  reason: z.string().optional(),
  requestedAt: Timestamp,
  respondedAt: Timestamp.optional(),
  expiresAt: Timestamp.optional(),
  requestedBy: NonEmptyString,
  approvedBy: NonEmptyString.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Approval = z.infer<typeof Approval>;

/**
 * Approval request input
 */
export const ApprovalRequest = z.object({
  type: ApprovalType,
  workspaceId: z.string(),
  sessionId: z.string(),
  jobId: z.string().optional(),
  tool: NonEmptyString.optional(),
  command: NonEmptyString.optional(),
  file: NonEmptyString.optional(),
  description: NonEmptyString,
  reason: z.string().optional(),
  expiresIn: z.number().int().positive().optional(), // seconds, default 5 min
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/**
 * Approval response input
 */
export const ApprovalResponse = z.object({
  id: UUID,
  approved: z.boolean(),
  reason: z.string().optional(),
});

export type ApprovalResponse = z.infer<typeof ApprovalResponse>;

/**
 * Approval filter
 */
export const ApprovalFilter = z.object({
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  status: ApprovalStatus.optional(),
  type: ApprovalType.optional(),
  since: Timestamp.optional(),
  until: Timestamp.optional(),
  limit: z.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export type ApprovalFilter = z.infer<typeof ApprovalFilter>;

/**
 * Approval list response
 */
export const ApprovalList = z.object({
  items: z.array(Approval),
  nextCursor: z.string().optional(),
  total: z.number().optional(),
});

export type ApprovalList = z.infer<typeof ApprovalList>;

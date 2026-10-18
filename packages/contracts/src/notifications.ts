/**
 * Notification schemas for pi-harness
 */

import { z } from 'zod';
import { Timestamp, UUID, NonEmptyString } from './base.js';

/**
 * Notification channel
 */
export const NotificationChannel = z.enum([
  'telegram',
  'email',
  'webhook',
  'desktop',
]);

export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * Notification priority
 */
export const NotificationPriority = z.enum(['low', 'normal', 'high', 'urgent']);

export type NotificationPriority = z.infer<typeof NotificationPriority>;

/**
 * Notification definition
 */
export const Notification = z.object({
  id: UUID,
  event: NonEmptyString,
  channel: NotificationChannel,
  priority: NotificationPriority.default('normal'),
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  title: NonEmptyString,
  message: NonEmptyString,
  data: z.record(z.string(), z.unknown()).optional(),
  buttons: z.array(z.object({
    text: NonEmptyString,
    action: NonEmptyString,
    targetId: z.string().optional(),
    url: z.string().url().optional(),
  })).optional(),
  sentAt: Timestamp.optional(),
  readAt: Timestamp.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Notification = z.infer<typeof Notification>;

/**
 * Notification creation input
 */
export const NotificationCreate = z.object({
  event: NonEmptyString,
  channel: NotificationChannel.default('telegram'),
  priority: NotificationPriority.default('normal'),
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  title: NonEmptyString,
  message: NonEmptyString,
  data: z.record(z.string(), z.unknown()).optional(),
  buttons: z.array(z.object({
    text: NonEmptyString,
    action: NonEmptyString,
    targetId: z.string().optional(),
    url: z.string().url().optional(),
  })).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type NotificationCreate = z.infer<typeof NotificationCreate>;

/**
 * Notification filter
 */
export const NotificationFilter = z.object({
  workspaceId: z.string().optional(),
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  channel: NotificationChannel.optional(),
  priority: NotificationPriority.optional(),
  since: Timestamp.optional(),
  until: Timestamp.optional(),
  limit: z.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export type NotificationFilter = z.infer<typeof NotificationFilter>;

/**
 * Notification list response
 */
export const NotificationList = z.object({
  items: z.array(Notification),
  nextCursor: z.string().optional(),
  total: z.number().optional(),
});

export type NotificationList = z.infer<typeof NotificationList>;

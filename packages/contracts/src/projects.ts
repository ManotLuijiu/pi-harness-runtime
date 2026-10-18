/**
 * Project schemas for pi-harness
 */

import { z } from 'zod';
import { Timestamp, UUID, NonEmptyString } from './base.js';

/**
 * Project status
 */
export const ProjectStatus = z.enum([
  'active',
  'archived',
  'deleted',
]);

export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Project definition
 */
export const Project = z.object({
  id: UUID,
  name: NonEmptyString,
  path: NonEmptyString,
  status: ProjectStatus.default('active'),
  workspaceId: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastAccessedAt: Timestamp.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Project = z.infer<typeof Project>;

/**
 * Project creation input
 */
export const ProjectCreate = z.object({
  name: NonEmptyString,
  path: NonEmptyString,
  workspaceId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProjectCreate = z.infer<typeof ProjectCreate>;

/**
 * Project update input
 */
export const ProjectUpdate = z.object({
  name: NonEmptyString.optional(),
  status: ProjectStatus.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

/**
 * Project filter
 */
export const ProjectFilter = z.object({
  workspaceId: z.string().optional(),
  status: ProjectStatus.optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export type ProjectFilter = z.infer<typeof ProjectFilter>;

/**
 * Project list response
 */
export const ProjectList = z.object({
  items: z.array(Project),
  nextCursor: z.string().optional(),
  total: z.number().optional(),
});

export type ProjectList = z.infer<typeof ProjectList>;

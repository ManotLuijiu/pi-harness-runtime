/**
 * pi-harness Contracts Package
 * 
 * Type-safe RPC schema definitions for all pi-harness services.
 * Uses Zod for runtime validation.
 * 
 * @example
 * ```typescript
 * import { schemas } from '@pi-harness/contracts';
 * 
 * const result = schemas.JobCreate.parse(input);
 * ```
 */

export * from './base.js';
export * from './events.js';
export * from './jobs.js';
export * from './sessions.js';
export * from './projects.js';
export * from './notifications.js';
export * from './approvals.js';
export * from './delegation.js';
export * from './delegation-assessor.js';
export * from './delegation-store.js';
export * from './scope-discovery.js';
export * from './work-partitioner.js';

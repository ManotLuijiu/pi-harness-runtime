/**
 * Autonomous Operations Runtime — Public API
 *
 * Phase 1 exports (RFC-0101 §1-2):
 * - TaskRecord, TaskLease, TaskEvent, TaskStatus, CapabilityName, ApprovalClass types
 * - TaskInbox: append, list, get, transition, complete, fail
 * - LeaseManager: claim, heartbeat, release, reap, recoverOnStartup
 *
 * Phase 2+ exports (added as implemented):
 * - Worker lifecycle (worker.ts)
 * - Privilege broker (privilege-broker package)
 * - Scheduler adapter (scheduler-adapter package)
 */
export * from "./types.js";
export { TaskInbox, InboxError } from "./inbox.js";
export { LeaseManager, LeaseError, DEFAULT_LEASE_TTL_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_EXTENSION_MS, } from "./lease.js";
//# sourceMappingURL=index.d.ts.map
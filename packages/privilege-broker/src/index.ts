/**
 * Privilege Broker — RFC-0101 §7
 *
 * Provides safe privilege escalation for autonomous tasks:
 * - Lists available capabilities
 * - Checks human approval
 * - Executes privileged operations safely
 *
 * Usage:
 * ```ts
 * import { PrivilegeBroker } from "@pi-harness/privilege-broker";
 *
 * const broker = new PrivilegeBroker({
 *   registry: defaultCapabilityRegistry(),
 *   audit: new ConsoleAuditLogger(),
 * });
 *
 * const ok = await broker.check(
 *   "run_command",
 *   { command: "npm test" },
 *   "pi-runtime-agent",
 * );
 * ```
 */
export type {
	PrivilegeEntry,
	PrivilegeRegistry,
	CapabilityName,
	CapabilityGrant,
	AuditEntry,
	AuditLogger,
	ApprovalClass,
} from "./types.js";
export { loadRegistry, type PrivilegeRegistryError } from "./registry.js";
export {
	type ApprovalResult,
	registerApprovalClass,
	checkApproval,
	clearApprovalCache,
} from "./approval.js";
export {
	NoOpAuditLogger,
	ConsoleAuditLogger,
	FileAuditLogger,
} from "./audit.js";
export { BrokerExecutor } from "./executor.js";

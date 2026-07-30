/**
 * Privilege Broker — Types
 * RFC-0101 §7-§8
 *
 * Duplicates CapabilityName from @pi/autonomous-runtime here to avoid
 * circular import issues in the workspace. Once the workspace is built,
 * this can be replaced with:
 *   import type { CapabilityName } from "@pi/autonomous-runtime";
 */

/** A named capability that the privilege broker may grant. */
export type CapabilityName =
	| "files.read"
	| "files.write"
	| "files.exec"
	| "git.commit"
	| "git.push"
	| "gh.api"
	| "npm.publish"
	| "run_command"
	| "sudo";

/** Policy for one capability. */
export interface PrivilegeEntry {
	capability: CapabilityName;
	/** Human-readable description shown in approval prompts. */
	description: string;
	/** Per-actor policy. Default deny if no match. */
	actors: Record<
		string,
		{
			/** "allow", "deny", or "ask" (requires human approval). */
			default: "allow" | "deny" | "ask";
			/** Optional: cron expression for time-of-day restriction. */
			time_window?: string;
			/** Optional: condition expression evaluated at runtime. */
			condition?: string;
			/** Max exec-time in ms. 0 = no limit. */
			timeout_ms?: number;
			/** Environment variable whitelist (exact keys). */
			env_whitelist?: string[];
			/** Optional: working directory constraint. */
			allowed_cwd?: string;
		}
	>;
	/** Approval class id — determines how to prompt human. */
	approval_class: string;
}

/** Loaded registry of all known capabilities. */
export interface PrivilegeRegistry {
	version: number;
	capabilities: PrivilegeEntry[];
}

/** Result of a broker.check() call. */
export interface CapabilityGrant {
	granted: boolean;
	reason: string;
	/** Filled if granted = true. */
	exec_options?: {
		timeout_ms?: number;
		env_whitelist?: string[];
		allowed_cwd?: string;
	};
}

/** Log entry for audit trail. */
export type AuditOutcome =
	| "granted"
	| "denied"
	| "auto_denied"
	| "auto_approved"
	| "error";

export interface AuditEntry {
	timestamp: string;
	workerId?: string;
	taskId?: string;
	actor: string;
	capability: CapabilityName;
	reason: string;
	outcome: AuditOutcome;
	success?: boolean;
	error?: string;
}

/** Audit logger interface. */
export interface AuditLogger {
	log(entry: AuditEntry): void;
}

/** Approval class — determines how to prompt the human. */
export interface ApprovalClass {
	id: string;
	/**
	 * Prompt the human for approval.
	 * Returns "granted" or "denied".
	 */
	prompt(
		capability: CapabilityName,
		actor: string,
		reason: string,
	): Promise<"granted" | "denied">;
}

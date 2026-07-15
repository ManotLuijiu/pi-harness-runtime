/**
 * Policy Engine — RFC-0028
 *
 * Policy enforcement for command execution, network access, and file operations.
 *
 * Features:
 * - Command allowlist/denylist
 * - Network access control
 * - File operation restrictions
 * - Rate limiting
 * - Audit logging
 * - Policy inheritance and composition
 */

import { EventEmitter } from "node:events";

export type PolicyEffect = "allow" | "deny" | "ask";

export interface PolicyResult {
	effect: PolicyEffect;
	reason?: string;
	policy?: string;
	score?: number;
}

export interface PolicyContext {
	/** Who/what is requesting access */
	subject: {
		user?: string;
		role?: string;
		agent?: string;
		ip?: string;
	};
	/** What resource is being accessed */
	resource: {
		type: "command" | "file" | "network" | "api" | "system";
		path?: string;
		url?: string;
		method?: string;
		operation?: string;
	};
	/** Environment context */
	environment?: {
		jobId?: string;
		taskId?: string;
		worktree?: string;
		workspace?: string;
	};
}

export interface Policy {
	id: string;
	name: string;
	description?: string;
	priority: number;
	effect: PolicyEffect;
	condition: PolicyCondition;
	action?: string;
	reason?: string;
	audit?: boolean;
}

export interface PolicyCondition {
	/** Match subject */
	subject?: {
		user?: string | string[];
		role?: string | string[];
		agent?: string | string[];
		ip?: string | string[];
	};
	/** Match resource */
	resource?: {
		type?: "command" | "file" | "network" | "api" | "system" | string;
		path?: string | string[];
		pathPattern?: string;
		url?: string | string[];
		urlPattern?: string;
		method?: string | string[];
		operation?: string | string[];
	};
	/** Match environment */
	environment?: {
		jobId?: string | string[];
		taskId?: string | string[];
		worktree?: string | string[];
		workspace?: string | string[];
	};
	/** Time-based conditions */
	time?: {
		startHour?: number;
		endHour?: number;
		days?: number[];
	};
	/** Custom condition function */
	custom?: (context: PolicyContext) => boolean;
}

export interface PolicyRule {
	pattern: RegExp;
	effect: PolicyEffect;
	reason?: string;
}

export interface RateLimit {
	maxRequests: number;
	windowMs: number;
}

export interface AuditEntry {
	timestamp: string;
	policy: string;
	effect: PolicyEffect;
	context: PolicyContext;
	reason?: string;
}

const DEFAULT_RATE_LIMIT: RateLimit = {
	maxRequests: 100,
	windowMs: 60000,
};

export class PolicyEngine extends EventEmitter {
	private policies: Policy[] = [];
	private commandRules: PolicyRule[] = [];
	private fileRules: PolicyRule[] = [];
	private networkRules: PolicyRule[] = [];
	private rateLimits: Map<string, RateLimit> = new Map();
	private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();
	private auditLog: AuditEntry[] = [];
	private maxAuditEntries = 10000;

	constructor() {
		super();
		this.initializeDefaultPolicies();
	}

	/**
	 * Initialize default security policies
	 */
	private initializeDefaultPolicies(): void {
		// Deny dangerous commands
		this.addPolicy({
			id: "deny-rm-rf",
			name: "Deny rm -rf /",
			description: "Block rm -rf on root",
			priority: 100,
			effect: "deny",
			condition: {
				subject: {},
				resource: {
					type: "command",
					pathPattern: "^\\s*rm\\s+-rf\\s+\\/",
				},
			},
			reason: "Cannot delete root directory",
		});

		// Allow safe development commands
		this.addPolicy({
			id: "allow-git",
			name: "Allow git commands",
			description: "Allow git operations",
			priority: 10,
			effect: "allow",
			condition: {
				resource: {
					type: "command",
					pathPattern: "^\\s*git\\s+",
				},
			},
		});

		// Allow npm/npx commands
		this.addPolicy({
			id: "allow-npm",
			name: "Allow npm/npx",
			description: "Allow npm package management",
			priority: 10,
			effect: "allow",
			condition: {
				resource: {
					type: "command",
					pathPattern: "^(npm|npx|yarn|pnpm)\\s+",
				},
			},
		});

		// Deny network to private IPs
		this.addPolicy({
			id: "deny-private-network",
			name: "Deny private network access",
			description: "Block access to private IP ranges",
			priority: 90,
			effect: "deny",
			condition: {
				resource: {
					type: "network",
					urlPattern: "^(10\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.|192\\.168\\.|127\\.|localhost)",
				},
			},
			reason: "Private network access is restricted",
		});

		// Allow HTTPS only
		this.addPolicy({
			id: "allow-https",
			name: "Allow HTTPS",
			description: "Allow secure HTTPS connections",
			priority: 20,
			effect: "allow",
			condition: {
				resource: {
					type: "network",
					urlPattern: "^https://",
				},
			},
		});

		// Block file access outside workspace
		this.addPolicy({
			id: "deny-outside-workspace",
			name: "Deny access outside workspace",
			description: "Block file operations outside workspace",
			priority: 80,
			effect: "deny",
			condition: {
				resource: {
					type: "file",
					pathPattern: "^\\.\\.(/|$)",
				},
			},
			reason: "Cannot access paths outside workspace",
		});
	}

	/**
	 * Add a policy
	 */
	addPolicy(policy: Policy): void {
		this.policies.push(policy);
		this.policies.sort((a, b) => b.priority - a.priority);
	}

	/**
	 * Remove a policy
	 */
	removePolicy(id: string): boolean {
		const index = this.policies.findIndex((p) => p.id === id);
		if (index !== -1) {
			this.policies.splice(index, 1);
			return true;
		}
		return false;
	}

	/**
	 * Get all policies
	 */
	getPolicies(): Policy[] {
		return [...this.policies];
	}

	/**
	 * Check if a request is allowed
	 */
	evaluate(context: PolicyContext): PolicyResult {
		// Check rate limits first
		const rateLimitResult = this.checkRateLimit(context);
		if (rateLimitResult.effect === "deny") {
			return rateLimitResult;
		}

		// Find matching policy
		for (const policy of this.policies) {
			if (this.matchesPolicy(context, policy)) {
				// Audit if enabled
				if (policy.audit) {
					this.logAudit(policy, context);
				}

				return {
					effect: policy.effect,
					reason: policy.reason,
					policy: policy.id,
				};
			}
		}

		// Default: ask for unknown resources
		return {
			effect: "ask",
			reason: "No matching policy found",
		};
	}

	/**
	 * Check if a command is allowed
	 */
	canExecuteCommand(command: string, context?: Partial<PolicyContext>): PolicyResult {
		const fullContext: PolicyContext = {
			subject: context?.subject ?? {},
			resource: {
				type: "command",
				path: command,
			},
			environment: context?.environment,
		};

		// Check against command rules first
		for (const rule of this.commandRules) {
			if (rule.pattern.test(command)) {
				this.logAudit(
					{ id: "command-rule", name: "Command Rule", priority: 0, effect: rule.effect } as Policy,
					fullContext,
				);

				return {
					effect: rule.effect,
					reason: rule.reason,
				};
			}
		}

		return this.evaluate(fullContext);
	}

	/**
	 * Check if a file operation is allowed
	 */
	canAccessFile(
		path: string,
		operation: "read" | "write" | "delete" | "execute",
		context?: Partial<PolicyContext>,
	): PolicyResult {
		const fullContext: PolicyContext = {
			subject: context?.subject ?? {},
			resource: {
				type: "file",
				path,
				operation,
			},
			environment: context?.environment,
		};

		// Check against file rules
		for (const rule of this.fileRules) {
			if (rule.pattern.test(path)) {
				this.logAudit(
					{ id: "file-rule", name: "File Rule", priority: 0, effect: rule.effect } as Policy,
					fullContext,
				);

				return {
					effect: rule.effect,
					reason: rule.reason,
				};
			}
		}

		return this.evaluate(fullContext);
	}

	/**
	 * Check if a network request is allowed
	 */
	canMakeNetworkRequest(
		url: string,
		method?: string,
		context?: Partial<PolicyContext>,
	): PolicyResult {
		const fullContext: PolicyContext = {
			subject: context?.subject ?? {},
			resource: {
				type: "network",
				url,
				method,
			},
			environment: context?.environment,
		};

		// Check against network rules
		for (const rule of this.networkRules) {
			if (rule.pattern.test(url)) {
				this.logAudit(
					{ id: "network-rule", name: "Network Rule", priority: 0, effect: rule.effect } as Policy,
					fullContext,
				);

				return {
					effect: rule.effect,
					reason: rule.reason,
				};
			}
		}

		return this.evaluate(fullContext);
	}

	/**
	 * Add a command rule
	 */
	addCommandRule(pattern: RegExp, effect: PolicyEffect, reason?: string): void {
		this.commandRules.push({ pattern, effect, reason });
	}

	/**
	 * Add a file rule
	 */
	addFileRule(pattern: RegExp, effect: PolicyEffect, reason?: string): void {
		this.fileRules.push({ pattern, effect, reason });
	}

	/**
	 * Add a network rule
	 */
	addNetworkRule(pattern: RegExp, effect: PolicyEffect, reason?: string): void {
		this.networkRules.push({ pattern, effect, reason });
	}

	/**
	 * Set rate limit for a resource
	 */
	setRateLimit(resource: string, limit: RateLimit): void {
		this.rateLimits.set(resource, limit);
	}

	/**
	 * Get rate limit for a resource
	 */
	getRateLimit(resource: string): RateLimit | undefined {
		return this.rateLimits.get(resource);
	}

	/**
	 * Get audit log
	 */
	getAuditLog(filter?: {
		policy?: string;
		effect?: PolicyEffect;
		since?: Date;
	}): AuditEntry[] {
		let entries = [...this.auditLog];

		if (filter?.policy) {
			entries = entries.filter((e) => e.policy === filter.policy);
		}

		if (filter?.effect) {
			entries = entries.filter((e) => e.effect === filter.effect);
		}

		if (filter?.since) {
			entries = entries.filter(
				(e) => new Date(e.timestamp) >= filter.since!,
			);
		}

		return entries;
	}

	/**
	 * Clear audit log
	 */
	clearAuditLog(): void {
		this.auditLog = [];
	}

	/**
	 * Export policies as JSON
	 */
	exportPolicies(): string {
		return JSON.stringify(
			{
				policies: this.policies,
				commandRules: this.commandRules.map((r) => ({
					pattern: r.pattern.source,
					effect: r.effect,
					reason: r.reason,
				})),
				fileRules: this.fileRules.map((r) => ({
					pattern: r.pattern.source,
					effect: r.effect,
					reason: r.reason,
				})),
				networkRules: this.networkRules.map((r) => ({
					pattern: r.pattern.source,
					effect: r.effect,
					reason: r.reason,
				})),
				rateLimits: Object.fromEntries(this.rateLimits),
			},
			null,
			2,
		);
	}

	/**
	 * Import policies from JSON
	 */
	importPolicies(json: string): boolean {
		try {
			const data = JSON.parse(json);

			if (data.policies) {
				this.policies = data.policies;
			}

			if (data.commandRules) {
				this.commandRules = data.commandRules.map(
					(r: { pattern: string; effect: PolicyEffect; reason?: string }) => ({
						pattern: new RegExp(r.pattern),
						effect: r.effect,
						reason: r.reason,
					}),
				);
			}

			if (data.fileRules) {
				this.fileRules = data.fileRules.map(
					(r: { pattern: string; effect: PolicyEffect; reason?: string }) => ({
						pattern: new RegExp(r.pattern),
						effect: r.effect,
						reason: r.reason,
					}),
				);
			}

			if (data.networkRules) {
				this.networkRules = data.networkRules.map(
					(r: { pattern: string; effect: PolicyEffect; reason?: string }) => ({
						pattern: new RegExp(r.pattern),
						effect: r.effect,
						reason: r.reason,
					}),
				);
			}

			if (data.rateLimits) {
				this.rateLimits = new Map(Object.entries(data.rateLimits));
			}

			return true;
		} catch {
			return false;
		}
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private matchesPolicy(context: PolicyContext, policy: Policy): boolean {
		const condition = policy.condition;

		// Check subject
		if (condition.subject && !this.matchesSubject(context, condition.subject)) {
			return false;
		}

		// Check resource
		if (condition.resource && !this.matchesResource(context, condition.resource)) {
			return false;
		}

		// Check environment
		if (condition.environment && !this.matchesEnvironment(context, condition.environment)) {
			return false;
		}

		// Check time
		if (condition.time && !this.matchesTime(condition.time)) {
			return false;
		}

		// Check custom
		if (condition.custom && !condition.custom(context)) {
			return false;
		}

		return true;
	}

	private matchesSubject(
		context: PolicyContext,
		condition: NonNullable<PolicyCondition["subject"]>,
	): boolean {
		const { user, role, agent, ip } = context.subject;

		if (user && condition.user) {
			if (!this.matchesValue(user, condition.user)) return false;
		}

		if (role && condition.role) {
			if (!this.matchesValue(role, condition.role)) return false;
		}

		if (agent && condition.agent) {
			if (!this.matchesValue(agent, condition.agent)) return false;
		}

		if (ip && condition.ip) {
			if (!this.matchesValue(ip, condition.ip)) return false;
		}

		return true;
	}

	private matchesResource(
		context: PolicyContext,
		condition: NonNullable<PolicyCondition["resource"]>,
	): boolean {
		const { type, path, url, method, operation } = context.resource;

		if (type && condition.type) {
			if (type !== condition.type && condition.type !== "*") return false;
		}

		if (path && (condition.path || condition.pathPattern)) {
			if (condition.path && !this.matchesValue(path, condition.path)) return false;
			if (condition.pathPattern && !new RegExp(condition.pathPattern).test(path)) {
				return false;
			}
		}

		if (url && (condition.url || condition.urlPattern)) {
			if (condition.url && !this.matchesValue(url, condition.url)) return false;
			if (condition.urlPattern && !new RegExp(condition.urlPattern).test(url)) {
				return false;
			}
		}

		if (method && condition.method) {
			if (!this.matchesValue(method, condition.method)) return false;
		}

		if (operation && condition.operation) {
			if (!this.matchesValue(operation, condition.operation)) return false;
		}

		return true;
	}

	private matchesEnvironment(
		context: PolicyContext,
		condition: NonNullable<PolicyCondition["environment"]>,
	): boolean {
		const env = context.environment ?? {};

		if (env.jobId && condition.jobId) {
			if (!this.matchesValue(env.jobId, condition.jobId)) return false;
		}

		if (env.taskId && condition.taskId) {
			if (!this.matchesValue(env.taskId, condition.taskId)) return false;
		}

		if (env.worktree && condition.worktree) {
			if (!this.matchesValue(env.worktree, condition.worktree)) return false;
		}

		if (env.workspace && condition.workspace) {
			if (!this.matchesValue(env.workspace, condition.workspace)) return false;
		}

		return true;
	}

	private matchesTime(condition: NonNullable<PolicyCondition["time"]>): boolean {
		const now = new Date();

		if (condition.startHour !== undefined && condition.endHour !== undefined) {
			const hour = now.getHours();
			if (condition.startHour <= condition.endHour) {
				if (hour < condition.startHour || hour > condition.endHour) return false;
			} else {
				// Handles overnight ranges like 22:00 - 06:00
				if (hour < condition.startHour && hour > condition.endHour) return false;
			}
		}

		if (condition.days && condition.days.length > 0) {
			const day = now.getDay();
			if (!condition.days.includes(day)) return false;
		}

		return true;
	}

	private matchesValue(value: string, pattern: string | string[]): boolean {
		if (Array.isArray(pattern)) {
			return pattern.includes(value);
		}

		// Check if pattern is a regex
		if (pattern.startsWith("/") && pattern.endsWith("/")) {
			try {
				return new RegExp(pattern.slice(1, -1)).test(value);
			} catch {
				return false;
			}
		}

		// Glob pattern
		if (pattern.includes("*")) {
			const regex = new RegExp(
				"^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
			);
			return regex.test(value);
		}

		return value === pattern;
	}

	private checkRateLimit(context: PolicyContext): PolicyResult {
		const key = this.getRateLimitKey(context);
		const limit = this.rateLimits.get(key) ?? DEFAULT_RATE_LIMIT;

		const now = Date.now();
		let record = this.requestCounts.get(key);

		if (!record || now - record.windowStart > limit.windowMs) {
			// Start new window
			record = { count: 1, windowStart: now };
			this.requestCounts.set(key, record);
			return { effect: "allow" };
		}

		record.count++;
		this.requestCounts.set(key, record);

		if (record.count > limit.maxRequests) {
			return {
				effect: "deny",
				reason: `Rate limit exceeded: ${record.count}/${limit.maxRequests} requests in ${limit.windowMs}ms`,
			};
		}

		return { effect: "allow" };
	}

	private getRateLimitKey(context: PolicyContext): string {
		const parts: string[] = [context.resource.type];

		if (context.subject.user) parts.push(context.subject.user);
		if (context.subject.agent) parts.push(context.subject.agent);
		if (context.resource.path) parts.push(context.resource.path);
		if (context.resource.url) parts.push(context.resource.url);

		return parts.join(":");
	}

	private logAudit(policy: Policy, context: PolicyContext): void {
		const entry: AuditEntry = {
			timestamp: new Date().toISOString(),
			policy: policy.id,
			effect: policy.effect,
			context,
			reason: policy.reason,
		};

		this.auditLog.push(entry);

		// Trim log if too large
		if (this.auditLog.length > this.maxAuditEntries) {
			this.auditLog = this.auditLog.slice(-this.maxAuditEntries / 2);
		}

		this.emit("audit", entry);
	}
}

/**
 * Create a PolicyEngine with default harness policies
 */
export function createHarnessPolicyEngine(): PolicyEngine {
	const engine = new PolicyEngine();

	// Add additional harness-specific policies
	engine.addPolicy({
		id: "allow-harness-internal",
		name: "Allow harness internal commands",
		description: "Allow internal harness commands",
		priority: 15,
		effect: "allow",
		condition: {
			resource: {
				type: "command",
				pathPattern: "^(pi|harness)-",
			},
		},
	});

	// Default deny for system commands
	engine.addPolicy({
		id: "deny-system",
		name: "Deny system commands",
		description: "Block system-level commands by default",
		priority: 70,
		effect: "deny",
		condition: {
			resource: {
				type: "command",
				pathPattern: "^(sudo|su|chmod|chown|mount|umount|reboot|shutdown)\\s",
			},
		},
		reason: "System commands are restricted",
	});

	// Set rate limits
	engine.setRateLimit("command", { maxRequests: 60, windowMs: 60000 }); // 60 commands/minute
	engine.setRateLimit("network", { maxRequests: 100, windowMs: 60000 }); // 100 requests/minute
	engine.setRateLimit("file", { maxRequests: 200, windowMs: 60000 }); // 200 file ops/minute

	return engine;
}

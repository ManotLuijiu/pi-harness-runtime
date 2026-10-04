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
export declare class PolicyEngine extends EventEmitter {
    private policies;
    private commandRules;
    private fileRules;
    private networkRules;
    private rateLimits;
    private requestCounts;
    private auditLog;
    private maxAuditEntries;
    constructor();
    /**
     * Initialize default security policies
     */
    private initializeDefaultPolicies;
    /**
     * Add a policy
     */
    addPolicy(policy: Policy): void;
    /**
     * Remove a policy
     */
    removePolicy(id: string): boolean;
    /**
     * Get all policies
     */
    getPolicies(): Policy[];
    /**
     * Check if a request is allowed
     */
    evaluate(context: PolicyContext): PolicyResult;
    /**
     * Check if a command is allowed
     */
    canExecuteCommand(command: string, context?: Partial<PolicyContext>): PolicyResult;
    /**
     * Check if a file operation is allowed
     */
    canAccessFile(path: string, operation: "read" | "write" | "delete" | "execute", context?: Partial<PolicyContext>): PolicyResult;
    /**
     * Check if a network request is allowed
     */
    canMakeNetworkRequest(url: string, method?: string, context?: Partial<PolicyContext>): PolicyResult;
    /**
     * Add a command rule
     */
    addCommandRule(pattern: RegExp, effect: PolicyEffect, reason?: string): void;
    /**
     * Add a file rule
     */
    addFileRule(pattern: RegExp, effect: PolicyEffect, reason?: string): void;
    /**
     * Add a network rule
     */
    addNetworkRule(pattern: RegExp, effect: PolicyEffect, reason?: string): void;
    /**
     * Set rate limit for a resource
     */
    setRateLimit(resource: string, limit: RateLimit): void;
    /**
     * Get rate limit for a resource
     */
    getRateLimit(resource: string): RateLimit | undefined;
    /**
     * Get audit log
     */
    getAuditLog(filter?: {
        policy?: string;
        effect?: PolicyEffect;
        since?: Date;
    }): AuditEntry[];
    /**
     * Clear audit log
     */
    clearAuditLog(): void;
    /**
     * Export policies as JSON
     */
    exportPolicies(): string;
    /**
     * Import policies from JSON
     */
    importPolicies(json: string): boolean;
    private matchesPolicy;
    private matchesSubject;
    private matchesResource;
    private matchesEnvironment;
    private matchesTime;
    private matchesValue;
    private checkRateLimit;
    private getRateLimitKey;
    private logAudit;
}
/**
 * Create a PolicyEngine with default harness policies
 */
export declare function createHarnessPolicyEngine(): PolicyEngine;
//# sourceMappingURL=policy-engine.d.ts.map
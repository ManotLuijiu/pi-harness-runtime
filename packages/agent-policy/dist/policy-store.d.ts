/**
 * PolicyStore - Session receipt tracking and validation.
 *
 * Responsibilities:
 * - Record when a policy revision was delivered to a session
 * - Validate receipts against current manifest
 * - Invalidate receipts when rules change
 * - Track delivery method (system_prompt vs tool)
 */
import type { PolicyManifest, PolicyReceipt } from "./types.js";
/**
 * Policy store configuration.
 */
export interface PolicyStoreConfig {
    /** Maximum receipts to keep per session (prevents memory leaks) */
    maxReceiptsPerSession?: number;
    /** Receipt TTL in milliseconds (default: 24 hours) */
    receiptTtlMs?: number;
}
/**
 * Stores policy receipts and validates delivery.
 */
export declare class PolicyStore {
    private receipts;
    private sessionScopes;
    private lastKnownManifests;
    private config;
    constructor(config?: PolicyStoreConfig);
    /**
     * Record a policy delivery for a session.
     */
    noteDelivered(sessionId: string, manifest: PolicyManifest, deliveryMethod?: "system_prompt" | "tool", sectionsDelivered?: string[]): PolicyReceipt;
    /**
     * Get receipt for a session, if it exists.
     */
    getReceipt(sessionId: string, projectRoot?: string, scope?: string): PolicyReceipt | null;
    /**
     * Check if a session has a valid receipt for the given manifest.
     */
    hasValidReceipt(sessionId: string, manifest: PolicyManifest): boolean;
    /**
     * Validate a receipt against the current manifest.
     */
    validateReceipt(sessionId: string, manifest: PolicyManifest): {
        valid: boolean;
        reason?: string;
    };
    /**
     * Invalidate receipts when a rule file changes.
     */
    invalidateOnChange(changedPath: string): string[];
    /**
     * Invalidate all receipts for a project root.
     */
    invalidateProject(projectRoot: string): void;
    /**
     * Invalidate all receipts (e.g., after compaction).
     */
    invalidateAll(): void;
    /**
     * Clear receipts for a specific session.
     */
    clearSession(sessionId: string): void;
    /**
     * Get all receipts for a session.
     */
    getSessionReceipts(sessionId: string): PolicyReceipt[];
    /**
     * Get statistics about stored receipts.
     */
    getStats(): {
        totalReceipts: number;
        sessionsTracked: number;
        projectsTracked: number;
        oldestReceipt: number | null;
        newestReceipt: number | null;
    };
    /**
     * Generate receipt key for storage.
     */
    private getReceiptKey;
    /**
     * Extract scope from manifest.
     */
    private getScopeFromManifest;
    /**
     * Cleanup old receipts to prevent memory leaks.
     */
    private cleanupOldReceipts;
}
/**
 * Get the global policy store instance.
 */
export declare function getPolicyStore(): PolicyStore;
/**
 * Reset the global policy store (for testing).
 */
export declare function resetPolicyStore(): void;
//# sourceMappingURL=policy-store.d.ts.map
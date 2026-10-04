/**
 * Write Approval Gate
 *
 * Stage writes (memory, skills) for human review before they land.
 * Based on Hermes Agent's consent-aware learning loop.
 */
/**
 * Pending write types
 */
export type PendingWriteType = "memory_add" | "memory_replace" | "memory_remove" | "skill_create" | "skill_patch" | "skill_delete" | "skill_file_write" | "skill_file_remove" | "user_profile_add";
/**
 * Pending write action
 */
export interface PendingWriteAction {
    type: PendingWriteType;
    target: string;
    content?: string;
    oldContent?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Pending write record
 */
export interface PendingWrite {
    id: string;
    action: PendingWriteAction;
    author: "agent" | "user" | "curator";
    timestamp: number;
    summary: string;
    details?: string;
}
/**
 * Write approval configuration
 */
export interface WriteApprovalConfig {
    /** Enable write approval */
    enabled: boolean;
    /** Directory to store pending writes */
    pendingDir: string;
    /** Max pending writes before warning */
    maxPending: number;
}
/**
 * Default configuration
 */
export declare const DEFAULT_APPROVAL_CONFIG: WriteApprovalConfig;
/**
 * Write Approval Gate
 */
export declare class WriteApprovalGate {
    private config;
    private pending;
    constructor(config?: Partial<WriteApprovalConfig>);
    /**
     * Load pending writes from disk
     */
    private load;
    /**
     * Save pending writes to disk
     */
    private save;
    /**
     * Stage a write for approval
     */
    stage(action: PendingWriteAction, author: "agent" | "user" | "curator"): PendingWrite;
    /**
     * Generate one-line summary for action
     */
    private generateSummary;
    /**
     * Generate details (diff) for action
     */
    private generateDetails;
    /**
     * Approve a pending write
     */
    approve(writeId: string): PendingWrite | null;
    /**
     * Approve all pending writes
     */
    approveAll(): PendingWrite[];
    /**
     * Reject a pending write
     */
    reject(writeId: string): PendingWrite | null;
    /**
     * Reject all pending writes
     */
    rejectAll(): PendingWrite[];
    /**
     * Get all pending writes
     */
    list(): PendingWrite[];
    /**
     * Get pending writes by type
     */
    listByType(type: PendingWriteType): PendingWrite[];
    /**
     * Get pending writes by author
     */
    listByAuthor(author: "agent" | "user" | "curator"): PendingWrite[];
    /**
     * Get pending count
     */
    count(): number;
    /**
     * Check if approval is required
     */
    requiresApproval(): boolean;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<WriteApprovalConfig>): void;
    /**
     * Get configuration
     */
    getConfig(): WriteApprovalConfig;
    /**
     * Format pending writes for display
     */
    formatList(): string;
    /**
     * Get age string for timestamp
     */
    private getAgeString;
}
export declare function getGlobalApprovalGate(): WriteApprovalGate;
export declare function createApprovalGate(config?: Partial<WriteApprovalConfig>): WriteApprovalGate;
/**
 * Helper to stage write with auto-approval if disabled
 */
export declare function stageWrite(action: PendingWriteAction, author: "agent" | "user" | "curator", autoApprove?: boolean): {
    staged: boolean;
    write?: PendingWrite;
};
//# sourceMappingURL=write-approval.d.ts.map
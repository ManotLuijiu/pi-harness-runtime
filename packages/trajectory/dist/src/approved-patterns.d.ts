/**
 * ApprovedPatternStore — tracks review patterns that have been approved.
 *
 * Once a reviewer approves code with a given comment, that comment pattern is
 * "learned" and the reviewer should not re-flag it in future sessions.
 *
 * Storage: `~/.pi-harness/approved-patterns.json`
 * Format: keyed by pattern-hash so lookup is O(1)
 *
 * Usage:
 * - Load patterns before each review → inject into reviewer prompt
 * - After "approved" verdict → call .approve() to persist new patterns
 */
export interface ApprovedPattern {
    hash: string;
    file?: string;
    comment: string;
    severity: string;
    approvedAt: string;
    approvalCount: number;
}
/** Singleton store for approved review patterns. */
export declare class ApprovedPatternStore {
    private readonly _path;
    private _data;
    constructor(path?: string);
    private _load;
    private _save;
    /** Check if a comment matches an approved pattern. Returns the pattern or null. */
    get(file: string | undefined, comment: string, severity: string): ApprovedPattern | null;
    /** Record that a pattern was approved. Called after "approved" verdict. */
    approve(comments: Array<{
        file?: string;
        comment: string;
        severity?: string;
    }>): void;
    /**
     * Build a markdown section for injecting into the reviewer prompt.
     * Lists previously-approved patterns so the reviewer can skip them.
     */
    toMarkdown(): string;
    /** Get count of known patterns. */
    get size(): number;
    /** Export all patterns as an array. */
    toArray(): ApprovedPattern[];
    /** Clear all patterns (for testing). */
    clear(): void;
}
export declare function getApprovedPatternStore(): ApprovedPatternStore;
export declare function resetApprovedPatternStore(): void;
//# sourceMappingURL=approved-patterns.d.ts.map
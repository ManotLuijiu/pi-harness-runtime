/**
 * Git Worktree Manager — RFC-0005
 *
 * Creates isolated workspaces for parallel or recoverable coding tasks.
 *
 * Goals:
 * - avoid branch conflicts
 * - preserve partial work
 * - allow reviewer agent to inspect diffs
 * - allow separate models to work on separate tasks
 */
import type { WorktreeInfo } from "../../types/src/runtime-types.js";
export interface WorktreeOptions {
    rootDir: string;
    baseBranch?: string;
}
export interface CreateWorktreeOptions {
    name: string;
    branch?: string;
    jobId?: string;
    taskId?: string;
    startPoint?: string;
}
export interface WorktreeDiff {
    file: string;
    status: "added" | "modified" | "deleted" | "renamed";
    insertions?: number;
    deletions?: number;
}
export declare class WorktreeManager {
    private readonly rootDir;
    private readonly baseBranch;
    private readonly metaPath;
    constructor(options: WorktreeOptions);
    /**
     * Create a new worktree
     */
    create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;
    /**
     * List all worktrees
     */
    list(): Promise<WorktreeInfo[]>;
    /**
     * Get worktree by name
     */
    get(name: string): Promise<WorktreeInfo | null>;
    /**
     * Get worktree by job ID
     */
    getByJob(jobId: string): Promise<WorktreeInfo | null>;
    /**
     * Remove a worktree
     */
    remove(name: string, force?: boolean): Promise<void>;
    /**
     * Prune stale worktrees
     */
    prune(): Promise<string[]>;
    /**
     * Get diff between worktree and base
     */
    getDiff(worktreePath: string): Promise<WorktreeDiff[]>;
    /**
     * Get uncommitted changes
     */
    getUncommitted(worktreePath: string): Promise<WorktreeDiff[]>;
    /**
     * Mark worktree as merged
     */
    markMerged(name: string): Promise<void>;
    /**
     * Execute git command
     */
    private execGit;
    /**
     * Save worktree to metadata
     */
    private saveWorktree;
    /**
     * Save all worktrees
     */
    private saveAllWorktrees;
    /**
     * List worktrees synchronously
     */
    private listSync;
}
//# sourceMappingURL=worktree.d.ts.map
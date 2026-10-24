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
/**
 * The file system calls the manager needs.
 *
 * The dependency is injected so that a test never has to replace `node:fs`
 * for the whole process: a module mock is global and would break every test
 * file that runs later.
 */
export interface WorktreeFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options: {
        recursive: true;
    }): string | undefined;
    writeFileSync(path: string, data: string, options: {
        encoding: "utf-8";
    }): void;
    readFileSync(path: string, encoding: "utf-8"): string;
}
/** The options the command runner receives. */
export interface WorktreeExecOptions {
    cwd: string;
    encoding: "utf-8";
    stdio: ["pipe", "pipe", "pipe"];
}
/** The command runner the manager needs (Git). */
export type WorktreeCommandRunner = (command: string, options: WorktreeExecOptions) => string;
export interface WorktreeOptions {
    rootDir: string;
    baseBranch?: string;
    /** The file system to use; the real one by default. */
    fs?: WorktreeFileSystem;
    /** The command runner to use; `execSync` by default. */
    exec?: WorktreeCommandRunner;
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
    private readonly fs;
    private readonly exec;
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
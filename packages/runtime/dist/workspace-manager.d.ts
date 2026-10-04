/**
 * Workspace Manager — RFC-0026
 *
 * Manages workspace directories, worktrees, and cleanup for the harness runtime.
 *
 * Features:
 * - Workspace lifecycle management
 * - Worktree creation and cleanup
 * - Disk usage tracking
 * - Automatic cleanup policies
 * - Workspace snapshots
 */
import { EventEmitter } from "node:events";
export interface Workspace {
    id: string;
    path: string;
    createdAt: string;
    lastAccessedAt: string;
    owner: string;
    purpose: string;
    sizeBytes: number;
    worktree?: string;
    isActive: boolean;
    metadata: Record<string, unknown>;
}
export interface WorkspaceConfig {
    /** Root directory for workspaces (default: ~/.pi/workspaces) */
    rootDir?: string;
    /** Maximum workspace age in days (default: 7) */
    maxAgeDays?: number;
    /** Maximum disk usage in bytes (default: 10GB) */
    maxDiskUsage?: number;
    /** Enable automatic cleanup (default: true) */
    autoCleanup?: boolean;
    /** Cleanup interval in ms (default: 1 hour) */
    cleanupIntervalMs?: number;
    /** Workspace prefix (default: ws-) */
    prefix?: string;
}
export interface WorkspaceEvent {
    workspaceId: string;
    timestamp: string;
    type: "created" | "accessed" | "cleaned" | "deleted" | "error";
    details?: string;
}
export declare class WorkspaceManager extends EventEmitter {
    private readonly config;
    private readonly rootDir;
    private workspaces;
    private cleanupTimer;
    private manifestPath;
    constructor(config?: WorkspaceConfig);
    /**
     * Create a new workspace
     */
    create(options: {
        owner: string;
        purpose: string;
        fromTemplate?: string;
        metadata?: Record<string, unknown>;
    }): Workspace;
    /**
     * Get a workspace by ID
     */
    get(id: string): Workspace | null;
    /**
     * Get workspace by path
     */
    getByPath(path: string): Workspace | null;
    /**
     * List all workspaces
     */
    list(filter?: {
        owner?: string;
        isActive?: boolean;
        olderThan?: Date;
    }): Workspace[];
    /**
     * Update workspace metadata
     */
    update(id: string, updates: Partial<Workspace>): boolean;
    /**
     * Mark workspace as complete (no longer active)
     */
    complete(id: string): boolean;
    /**
     * Delete a workspace
     */
    delete(id: string, force?: boolean): boolean;
    /**
     * Delete all workspaces for an owner
     */
    deleteByOwner(owner: string, force?: boolean): number;
    /**
     * Get workspace disk usage
     */
    getDiskUsage(): {
        total: number;
        byOwner: Record<string, number>;
    };
    /**
     * Check if cleanup is needed
     */
    isCleanupNeeded(): boolean;
    /**
     * Run cleanup
     */
    cleanup(options?: {
        olderThanDays?: number;
        owner?: string;
        dryRun?: boolean;
    }): {
        deleted: number;
        freedBytes: number;
        workspaces: string[];
    };
    /**
     * Create a worktree from a workspace
     */
    createWorktree(workspaceId: string, branchName: string): string | null;
    /**
     * Start automatic cleanup timer
     */
    startAutoCleanup(): void;
    /**
     * Stop automatic cleanup timer
     */
    stopAutoCleanup(): void;
    /**
     * Snapshot a workspace
     */
    snapshot(workspaceId: string, name: string): string | null;
    /**
     * Get workspace statistics
     */
    getStats(): {
        total: number;
        active: number;
        totalSize: number;
        oldest: string | null;
        newest: string | null;
    };
    /**
     * Verify workspace integrity
     */
    verify(id: string): {
        exists: boolean;
        size: number;
        isAccessible: boolean;
    };
    private ensureRootDir;
    private generateId;
    private calculateDirSize;
    private copyDirectory;
    private loadManifest;
    private saveManifest;
}
/**
 * Create a WorkspaceManager with default config for harness runtime
 */
export declare function createHarnessWorkspaceManager(): WorkspaceManager;
//# sourceMappingURL=workspace-manager.d.ts.map
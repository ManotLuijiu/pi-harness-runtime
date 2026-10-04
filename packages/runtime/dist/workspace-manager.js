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
import { existsSync, mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync, cpSync, } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
const DEFAULT_CONFIG = {
    maxAgeDays: 7,
    maxDiskUsage: 10 * 1024 * 1024 * 1024, // 10GB
    autoCleanup: true,
    cleanupIntervalMs: 3600000, // 1 hour
    prefix: "ws-",
};
export class WorkspaceManager extends EventEmitter {
    config;
    rootDir;
    workspaces = new Map();
    cleanupTimer = null;
    manifestPath;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.rootDir = this.config.rootDir ?? join(homedir(), ".pi", "workspaces");
        this.manifestPath = join(this.rootDir, "workspaces.json");
        this.ensureRootDir();
        this.loadManifest();
    }
    /**
     * Create a new workspace
     */
    create(options) {
        const id = this.generateId();
        const path = join(this.rootDir, id);
        // Create directory
        mkdirSync(path, { recursive: true });
        // Copy template if specified
        if (options.fromTemplate && existsSync(options.fromTemplate)) {
            this.copyDirectory(options.fromTemplate, path);
        }
        const workspace = {
            id,
            path,
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            owner: options.owner,
            purpose: options.purpose,
            sizeBytes: this.calculateDirSize(path),
            isActive: true,
            metadata: options.metadata ?? {},
        };
        this.workspaces.set(id, workspace);
        this.saveManifest();
        this.emit("workspace", {
            workspaceId: id,
            timestamp: new Date().toISOString(),
            type: "created",
            details: `Created workspace for ${options.owner}: ${options.purpose}`,
        });
        return workspace;
    }
    /**
     * Get a workspace by ID
     */
    get(id) {
        const workspace = this.workspaces.get(id);
        if (workspace) {
            // Update last accessed
            workspace.lastAccessedAt = new Date().toISOString();
            this.saveManifest();
        }
        return workspace ?? null;
    }
    /**
     * Get workspace by path
     */
    getByPath(path) {
        for (const workspace of Array.from(this.workspaces.values())) {
            if (workspace.path === path || workspace.path.startsWith(path + "/")) {
                return workspace;
            }
        }
        return null;
    }
    /**
     * List all workspaces
     */
    list(filter) {
        let result = Array.from(this.workspaces.values());
        if (filter?.owner) {
            result = result.filter((ws) => ws.owner === filter.owner);
        }
        if (filter?.isActive !== undefined) {
            result = result.filter((ws) => ws.isActive === filter.isActive);
        }
        if (filter?.olderThan) {
            result = result.filter((ws) => new Date(ws.lastAccessedAt) < filter.olderThan);
        }
        return result;
    }
    /**
     * Update workspace metadata
     */
    update(id, updates) {
        const workspace = this.workspaces.get(id);
        if (!workspace) {
            return false;
        }
        Object.assign(workspace, updates, {
            lastAccessedAt: new Date().toISOString(),
        });
        this.saveManifest();
        return true;
    }
    /**
     * Mark workspace as complete (no longer active)
     */
    complete(id) {
        return this.update(id, { isActive: false });
    }
    /**
     * Delete a workspace
     */
    delete(id, force = false) {
        const workspace = this.workspaces.get(id);
        if (!workspace) {
            return false;
        }
        // Check if active and not forced
        if (workspace.isActive && !force) {
            return false;
        }
        // Delete directory
        try {
            rmSync(workspace.path, { recursive: true, force: true });
        }
        catch (error) {
            this.emit("workspace", {
                workspaceId: id,
                timestamp: new Date().toISOString(),
                type: "error",
                details: `Failed to delete: ${error}`,
            });
            return false;
        }
        this.workspaces.delete(id);
        this.saveManifest();
        this.emit("workspace", {
            workspaceId: id,
            timestamp: new Date().toISOString(),
            type: "deleted",
            details: `Deleted workspace ${id}`,
        });
        return true;
    }
    /**
     * Delete all workspaces for an owner
     */
    deleteByOwner(owner, force = false) {
        const toDelete = this.list({ owner, isActive: false });
        let deleted = 0;
        for (const workspace of toDelete) {
            if (this.delete(workspace.id, force)) {
                deleted++;
            }
        }
        return deleted;
    }
    /**
     * Get workspace disk usage
     */
    getDiskUsage() {
        const byOwner = {};
        let total = 0;
        for (const workspace of Array.from(this.workspaces.values())) {
            const size = workspace.sizeBytes;
            total += size;
            byOwner[workspace.owner] = (byOwner[workspace.owner] ?? 0) + size;
        }
        return { total, byOwner };
    }
    /**
     * Check if cleanup is needed
     */
    isCleanupNeeded() {
        const usage = this.getDiskUsage();
        // Check disk usage
        const maxDisk = this.config.maxDiskUsage ?? DEFAULT_CONFIG.maxDiskUsage;
        if (usage.total > maxDisk) {
            return true;
        }
        // Check for old workspaces
        const cutoff = new Date();
        const maxAge = this.config.maxAgeDays ?? DEFAULT_CONFIG.maxAgeDays;
        if (maxAge) {
            cutoff.setDate(cutoff.getDate() - maxAge);
        }
        for (const workspace of Array.from(this.workspaces.values())) {
            if (new Date(workspace.lastAccessedAt) < cutoff) {
                return true;
            }
        }
        return false;
    }
    /**
     * Run cleanup
     */
    cleanup(options) {
        const olderThan = new Date();
        const daysToSubtract = options?.olderThanDays ?? this.config.maxAgeDays;
        if (daysToSubtract) {
            olderThan.setDate(olderThan.getDate() - daysToSubtract);
        }
        const toDelete = this.list({
            owner: options?.owner,
            isActive: false,
            olderThan,
        });
        let deleted = 0;
        let freedBytes = 0;
        const deletedIds = [];
        for (const workspace of Array.from(toDelete)) {
            if (options?.dryRun) {
                deletedIds.push(workspace.id);
                freedBytes += workspace.sizeBytes;
                deleted++;
            }
            else {
                if (this.delete(workspace.id, true)) {
                    deletedIds.push(workspace.id);
                    freedBytes += workspace.sizeBytes;
                    deleted++;
                    this.emit("workspace", {
                        workspaceId: workspace.id,
                        timestamp: new Date().toISOString(),
                        type: "cleaned",
                        details: `Cleaned up workspace (${freedBytes} bytes freed)`,
                    });
                }
            }
        }
        return { deleted, freedBytes, workspaces: deletedIds };
    }
    /**
     * Create a worktree from a workspace
     */
    createWorktree(workspaceId, branchName) {
        const workspace = this.workspaces.get(workspaceId);
        if (!workspace) {
            return null;
        }
        const worktreePath = join(this.rootDir, `${workspaceId}-${branchName}`);
        // This would typically use git worktree add
        // For now, create a symlink-style directory
        try {
            cpSync(workspace.path, worktreePath, { recursive: true });
            workspace.worktree = worktreePath;
            this.saveManifest();
            return worktreePath;
        }
        catch {
            return null;
        }
    }
    /**
     * Start automatic cleanup timer
     */
    startAutoCleanup() {
        if (this.cleanupTimer) {
            return;
        }
        this.cleanupTimer = setInterval(() => {
            if (this.isCleanupNeeded()) {
                this.cleanup();
            }
        }, this.config.cleanupIntervalMs);
    }
    /**
     * Stop automatic cleanup timer
     */
    stopAutoCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Snapshot a workspace
     */
    snapshot(workspaceId, name) {
        const workspace = this.workspaces.get(workspaceId);
        if (!workspace) {
            return null;
        }
        const snapshotDir = join(this.rootDir, ".snapshots", workspaceId);
        const snapshotPath = join(snapshotDir, `${name}-${Date.now()}.tar.gz`);
        try {
            mkdirSync(snapshotDir, { recursive: true });
            // In a real implementation, we'd use tar or a proper archive library
            // For now, just copy the directory
            cpSync(workspace.path, snapshotPath, { recursive: true });
            return snapshotPath;
        }
        catch {
            return null;
        }
    }
    /**
     * Get workspace statistics
     */
    getStats() {
        let total = 0;
        let active = 0;
        let totalSize = 0;
        let oldest = null;
        let newest = null;
        let oldestDate = new Date(0);
        let newestDate = new Date(0);
        for (const workspace of Array.from(this.workspaces.values())) {
            total++;
            totalSize += workspace.sizeBytes;
            if (workspace.isActive)
                active++;
            const created = new Date(workspace.createdAt);
            if (created > newestDate) {
                newestDate = created;
                newest = workspace.id;
            }
            if (created < oldestDate) {
                oldestDate = created;
                oldest = workspace.id;
            }
        }
        return { total, active, totalSize, oldest, newest };
    }
    /**
     * Verify workspace integrity
     */
    verify(id) {
        const workspace = this.workspaces.get(id);
        if (!workspace) {
            return { exists: false, size: 0, isAccessible: false };
        }
        const exists = existsSync(workspace.path);
        let size = 0;
        let isAccessible = false;
        if (exists) {
            try {
                size = this.calculateDirSize(workspace.path);
                isAccessible = true;
                // Update stored size
                this.update(id, { sizeBytes: size });
            }
            catch {
                isAccessible = false;
            }
        }
        return { exists, size, isAccessible };
    }
    // --- Private Methods ------------------------------------------------
    ensureRootDir() {
        if (!existsSync(this.rootDir)) {
            mkdirSync(this.rootDir, { recursive: true });
        }
    }
    generateId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `${this.config.prefix}${timestamp}-${random}`;
    }
    calculateDirSize(dirPath) {
        if (!existsSync(dirPath)) {
            return 0;
        }
        let size = 0;
        try {
            const entries = readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    size += this.calculateDirSize(fullPath);
                }
                else if (entry.isFile()) {
                    try {
                        size += statSync(fullPath).size;
                    }
                    catch {
                        // Skip inaccessible files
                    }
                }
            }
        }
        catch {
            // Skip inaccessible directories
        }
        return size;
    }
    copyDirectory(src, dest) {
        if (!existsSync(src)) {
            return;
        }
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
    }
    loadManifest() {
        if (!existsSync(this.manifestPath)) {
            return;
        }
        try {
            const data = readFileSync(this.manifestPath, "utf-8");
            const workspaces = JSON.parse(data);
            for (const workspace of workspaces) {
                this.workspaces.set(workspace.id, workspace);
            }
        }
        catch {
            // Ignore corrupt manifest
        }
    }
    saveManifest() {
        const workspaces = Array.from(this.workspaces.values());
        try {
            writeFileSync(this.manifestPath, JSON.stringify(workspaces, null, 2), "utf-8");
        }
        catch {
            // Ignore save errors
        }
    }
}
/**
 * Create a WorkspaceManager with default config for harness runtime
 */
export function createHarnessWorkspaceManager() {
    return new WorkspaceManager({
        rootDir: join(homedir(), ".pi", "harness", "workspaces"),
        maxAgeDays: 7,
        maxDiskUsage: 10 * 1024 * 1024 * 1024, // 10GB
        autoCleanup: true,
        cleanupIntervalMs: 3600000, // 1 hour
    });
}
//# sourceMappingURL=workspace-manager.js.map
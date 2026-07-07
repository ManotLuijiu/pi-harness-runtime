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

import {
	existsSync,
	mkdirSync,
	rmSync,
	readdirSync,
	statSync,
	writeFileSync,
	readFileSync,
	cpSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";

export interface Workspace {
	id: string;
	path: string;
	createdAt: string;
	lastAccessedAt: string;
	owner: string; // jobId
	purpose: string;
	sizeBytes: number;
	worktree?: string; // Git worktree path
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

const DEFAULT_CONFIG: Required<Omit<WorkspaceConfig, "rootDir">> = {
	maxAgeDays: 7,
	maxDiskUsage: 10 * 1024 * 1024 * 1024, // 10GB
	autoCleanup: true,
	cleanupIntervalMs: 3600000, // 1 hour
	prefix: "ws-",
};

export class WorkspaceManager extends EventEmitter {
	private readonly config: WorkspaceConfig;
	private readonly rootDir: string;
	private workspaces: Map<string, Workspace> = new Map();
	private cleanupTimer: NodeJS.Timeout | null = null;
	private manifestPath: string;

	constructor(config: WorkspaceConfig = {}) {
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
	create(options: {
		owner: string;
		purpose: string;
		fromTemplate?: string;
		metadata?: Record<string, unknown>;
	}): Workspace {
		const id = this.generateId();
		const path = join(this.rootDir, id);

		// Create directory
		mkdirSync(path, { recursive: true });

		// Copy template if specified
		if (options.fromTemplate && existsSync(options.fromTemplate)) {
			this.copyDirectory(options.fromTemplate, path);
		}

		const workspace: Workspace = {
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
	get(id: string): Workspace | null {
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
	getByPath(path: string): Workspace | null {
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
	list(filter?: {
		owner?: string;
		isActive?: boolean;
		olderThan?: Date;
	}): Workspace[] {
		let result = Array.from(this.workspaces.values());

		if (filter?.owner) {
			result = result.filter((ws) => ws.owner === filter.owner);
		}

		if (filter?.isActive !== undefined) {
			result = result.filter((ws) => ws.isActive === filter.isActive);
		}

		if (filter?.olderThan) {
			result = result.filter(
				(ws) => new Date(ws.lastAccessedAt) < filter.olderThan!,
			);
		}

		return result;
	}

	/**
	 * Update workspace metadata
	 */
	update(id: string, updates: Partial<Workspace>): boolean {
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
	complete(id: string): boolean {
		return this.update(id, { isActive: false });
	}

	/**
	 * Delete a workspace
	 */
	delete(id: string, force: boolean = false): boolean {
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
		} catch (error) {
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
	deleteByOwner(owner: string, force: boolean = false): number {
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
	getDiskUsage(): { total: number; byOwner: Record<string, number> } {
		const byOwner: Record<string, number> = {};
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
	isCleanupNeeded(): boolean {
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
	cleanup(options?: {
		olderThanDays?: number;
		owner?: string;
		dryRun?: boolean;
	}): { deleted: number; freedBytes: number; workspaces: string[] } {
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
		const deletedIds: string[] = [];

		for (const workspace of Array.from(toDelete)) {
			if (options?.dryRun) {
				deletedIds.push(workspace.id);
				freedBytes += workspace.sizeBytes;
				deleted++;
			} else {
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
	createWorktree(workspaceId: string, branchName: string): string | null {
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
		} catch {
			return null;
		}
	}

	/**
	 * Start automatic cleanup timer
	 */
	startAutoCleanup(): void {
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
	stopAutoCleanup(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
	}

	/**
	 * Snapshot a workspace
	 */
	snapshot(workspaceId: string, name: string): string | null {
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
		} catch {
			return null;
		}
	}

	/**
	 * Get workspace statistics
	 */
	getStats(): {
		total: number;
		active: number;
		totalSize: number;
		oldest: string | null;
		newest: string | null;
	} {
		let total = 0;
		let active = 0;
		let totalSize = 0;
		let oldest: string | null = null;
		let newest: string | null = null;
		let oldestDate = new Date(0);
		let newestDate = new Date(0);

		for (const workspace of Array.from(this.workspaces.values())) {
			total++;
			totalSize += workspace.sizeBytes;

			if (workspace.isActive) active++;

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
	verify(id: string): { exists: boolean; size: number; isAccessible: boolean } {
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
			} catch {
				isAccessible = false;
			}
		}

		return { exists, size, isAccessible };
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private ensureRootDir(): void {
		if (!existsSync(this.rootDir)) {
			mkdirSync(this.rootDir, { recursive: true });
		}
	}

	private generateId(): string {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 8);
		return `${this.config.prefix}${timestamp}-${random}`;
	}

	private calculateDirSize(dirPath: string): number {
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
				} else if (entry.isFile()) {
					try {
						size += statSync(fullPath).size;
					} catch {
						// Skip inaccessible files
					}
				}
			}
		} catch {
			// Skip inaccessible directories
		}

		return size;
	}

	private copyDirectory(src: string, dest: string): void {
		if (!existsSync(src)) {
			return;
		}

		mkdirSync(dest, { recursive: true });
		cpSync(src, dest, { recursive: true });
	}

	private loadManifest(): void {
		if (!existsSync(this.manifestPath)) {
			return;
		}

		try {
			const data = readFileSync(this.manifestPath, "utf-8");
			const workspaces = JSON.parse(data) as Workspace[];

			for (const workspace of workspaces) {
				this.workspaces.set(workspace.id, workspace);
			}
		} catch {
			// Ignore corrupt manifest
		}
	}

	private saveManifest(): void {
		const workspaces = Array.from(this.workspaces.values());

		try {
			writeFileSync(
				this.manifestPath,
				JSON.stringify(workspaces, null, 2),
				"utf-8",
			);
		} catch {
			// Ignore save errors
		}
	}
}

/**
 * Create a WorkspaceManager with default config for harness runtime
 */
export function createHarnessWorkspaceManager(): WorkspaceManager {
	return new WorkspaceManager({
		rootDir: join(homedir(), ".pi", "harness", "workspaces"),
		maxAgeDays: 7,
		maxDiskUsage: 10 * 1024 * 1024 * 1024, // 10GB
		autoCleanup: true,
		cleanupIntervalMs: 3600000, // 1 hour
	});
}

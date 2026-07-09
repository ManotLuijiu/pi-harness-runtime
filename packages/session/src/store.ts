/**
 * Session Manager - Store
 *
 * Session persistence to disk with indexing.
 */

import {
	readdir,
	readFile,
	writeFile,
	mkdir,
	rename,
	unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	Session,
	SessionContext,
	SessionStoreConfig,
	SessionStatus,
} from "./types.js";

// ─── Session Index ────────────────────────────────────────────────────────

/**
 * Session index entry
 */
interface SessionIndexEntry {
	id: string;
	userId: string;
	status: SessionStatus;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
	messageCount: number;
	totalTokens: number;
}

// ─── Session Store ────────────────────────────────────────────────────────

export class SessionStore {
	private readonly rootDir: string;
	private readonly autoSave: boolean;
	private readonly autoSaveIntervalMs: number;
	private readonly maxSessions?: number;

	/**
	 * Get max sessions limit
	 */
	getMaxSessions(): number | undefined {
		return this.maxSessions;
	}
	private indices: Map<string, SessionIndexEntry> = new Map();
	private autoSaveTimers: Map<string, NodeJS.Timeout> = new Map();

	constructor(config: SessionStoreConfig) {
		this.rootDir = config.rootDir;
		this.autoSave = config.autoSave;
		this.autoSaveIntervalMs = config.autoSaveIntervalMs;
		this.maxSessions = config.maxSessions;
	}

	/**
	 * Ensure directory exists
	 */
	private async ensureDir(dir: string): Promise<void> {
		await mkdir(dir, { recursive: true });
	}

	/**
	 * Get session directory
	 */
	private sessionDir(sessionId: string): string {
		return join(this.rootDir, "sessions", sessionId.slice(0, 2), sessionId);
	}

	/**
	 * Get session file path
	 */
	private sessionPath(sessionId: string): string {
		return join(this.sessionDir(sessionId), "session.json");
	}

	/**
	 * Get index file path
	 */
	private indexPath(): string {
		return join(this.rootDir, "sessions", "index.json");
	}

	/**
	 * Load or create index
	 */
	private async loadIndex(): Promise<Map<string, SessionIndexEntry>> {
		const path = this.indexPath();
		try {
			const content = await readFile(path, "utf-8");
			const entries = JSON.parse(content) as SessionIndexEntry[];
			return new Map(entries.map((e) => [e.id, e]));
		} catch {
			return new Map();
		}
	}

	/**
	 * Save index
	 */
	private async saveIndex(): Promise<void> {
		const entries = Array.from(this.indices.values());
		await this.ensureDir(dirname(this.indexPath()));
		await writeFile(
			this.indexPath(),
			JSON.stringify(entries, null, 2),
			"utf-8",
		);
	}

	/**
	 * Save session context to disk
	 */
	private async saveToDisk(context: SessionContext): Promise<void> {
		const path = this.sessionPath(context.id);
		await this.ensureDir(dirname(path));
		const tmp = `${path}.tmp`;
		await writeFile(tmp, JSON.stringify(context, null, 2), "utf-8");
		await rename(tmp, path);
	}

	/**
	 * Load session context from disk
	 */
	private async loadFromDisk(
		sessionId: string,
	): Promise<SessionContext | null> {
		const path = this.sessionPath(sessionId);
		try {
			const content = await readFile(path, "utf-8");
			return JSON.parse(content) as SessionContext;
		} catch {
			return null;
		}
	}

	/**
	 * Create or update session index entry
	 */
	private updateIndexEntry(context: SessionContext): void {
		this.indices.set(context.id, {
			id: context.id,
			userId: context.userId,
			status: context.status,
			createdAt: context.createdAt,
			updatedAt: context.updatedAt,
			expiresAt: context.expiresAt,
			messageCount: context.messages.length,
			totalTokens: context.tokenUsage.totalTokens,
		});
	}

	/**
	 * Initialize the store
	 */
	async initialize(): Promise<void> {
		await this.ensureDir(this.rootDir);
		this.indices = await this.loadIndex();
	}

	/**
	 * Save session context
	 */
	async save(context: SessionContext): Promise<void> {
		this.updateIndexEntry(context);
		await this.saveToDisk(context);

		if (this.autoSave) {
			this.scheduleAutoSave(context.id);
		}

		// Save index periodically
		await this.saveIndex();
	}

	/**
	 * Schedule auto-save for a session
	 */
	private scheduleAutoSave(sessionId: string): void {
		// Clear existing timer
		const existing = this.autoSaveTimers.get(sessionId);
		if (existing) {
			clearTimeout(existing);
		}

		// Schedule new save
		const timer = setTimeout(async () => {
			this.autoSaveTimers.delete(sessionId);
			const context = await this.loadFromDisk(sessionId);
			if (context) {
				await this.saveToDisk(context);
			}
		}, this.autoSaveIntervalMs);

		this.autoSaveTimers.set(sessionId, timer);
	}

	/**
	 * Load session context
	 */
	async load(sessionId: string): Promise<SessionContext | null> {
		return this.loadFromDisk(sessionId);
	}

	/**
	 * Delete session
	 */
	async delete(sessionId: string): Promise<void> {
		// Cancel auto-save
		const timer = this.autoSaveTimers.get(sessionId);
		if (timer) {
			clearTimeout(timer);
			this.autoSaveTimers.delete(sessionId);
		}

		// Remove from index
		this.indices.delete(sessionId);

		// Delete files
		const dir = this.sessionDir(sessionId);
		try {
			const files = await readdir(dir);
			await Promise.all(files.map((f) => unlink(join(dir, f))));
		} catch {
			// Ignore if directory doesn't exist
		}

		// Update index
		await this.saveIndex();
	}

	/**
	 * List sessions for a user
	 */
	async listByUser(userId: string): Promise<Session[]> {
		const entries = Array.from(this.indices.values()).filter(
			(e) => e.userId === userId,
		);

		return entries.map((e) => ({
			id: e.id,
			userId: e.userId,
			status: e.status,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
			lastActivityAt: e.updatedAt,
			expiresAt: e.expiresAt,
		}));
	}

	/**
	 * List all sessions
	 */
	async listAll(): Promise<Session[]> {
		const entries = Array.from(this.indices.values());

		return entries.map((e) => ({
			id: e.id,
			userId: e.userId,
			status: e.status,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
			lastActivityAt: e.updatedAt,
			expiresAt: e.expiresAt,
		}));
	}

	/**
	 * Get session summary without loading full context
	 */
	async getSummary(sessionId: string): Promise<Session | null> {
		const entry = this.indices.get(sessionId);
		if (!entry) return null;

		return {
			id: entry.id,
			userId: entry.userId,
			status: entry.status,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			lastActivityAt: entry.updatedAt,
			expiresAt: entry.expiresAt,
		};
	}

	/**
	 * Check if session exists
	 */
	async exists(sessionId: string): Promise<boolean> {
		return this.indices.has(sessionId);
	}

	/**
	 * Get session count
	 */
	async count(): Promise<number> {
		return this.indices.size;
	}

	/**
	 * Get sessions by status
	 */
	async listByStatus(status: SessionStatus): Promise<Session[]> {
		const entries = Array.from(this.indices.values()).filter(
			(e) => e.status === status,
		);

		return entries.map((e) => ({
			id: e.id,
			userId: e.userId,
			status: e.status,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
			lastActivityAt: e.updatedAt,
			expiresAt: e.expiresAt,
		}));
	}

	/**
	 * Close store and cleanup
	 */
	async close(): Promise<void> {
		// Clear all auto-save timers
		for (const timer of this.autoSaveTimers.values()) {
			clearTimeout(timer);
		}
		this.autoSaveTimers.clear();

		// Save final index
		await this.saveIndex();
	}
}

// ─── Factory Function ────────────────────────────────────────────────────

/**
 * Create a session store
 */
export function createSessionStore(config: SessionStoreConfig): SessionStore {
	return new SessionStore(config);
}

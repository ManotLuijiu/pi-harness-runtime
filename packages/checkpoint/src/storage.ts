/**
 * Checkpoint Engine - Storage
 *
 * File I/O with compression and checksum verification.
 */

import { createHash } from "node:crypto";
import {
	readFile,
	writeFile,
	mkdir,
	rename,
	stat,
	unlink,
	readdir,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	CheckpointFile,
	CheckpointIndex,
	CheckpointMetadata,
	FullCheckpoint,
	IncrementalCheckpoint,
	StateDelta,
} from "./types.js";

// ─── Default Configuration ─────────────────────────────────────────────────

const DEFAULT_CONFIG = {
	compression: true,
	checksumAlgorithm: "sha256" as const,
};

// ─── Storage Manager ──────────────────────────────────────────────────────

export class StorageManager {
	private readonly rootDir: string;
	private readonly compression: boolean;
	private readonly checksumAlgorithm: "md5" | "sha256";
	private indices: Map<string, CheckpointIndex> = new Map();

	constructor(
		rootDir: string,
		options: {
			compression?: boolean;
			checksumAlgorithm?: "md5" | "sha256";
		} = {},
	) {
		this.rootDir = rootDir;
		this.compression = options.compression ?? DEFAULT_CONFIG.compression;
		this.checksumAlgorithm =
			options.checksumAlgorithm ?? DEFAULT_CONFIG.checksumAlgorithm;
	}

	/**
	 * Ensure directory exists
	 */
	private async ensureDir(dir: string): Promise<void> {
		await mkdir(dir, { recursive: true });
	}

	/**
	 * Get job directory path
	 */
	private jobDir(jobId: string): string {
		return join(this.rootDir, "jobs", jobId);
	}

	/**
	 * Get checkpoint file path
	 */
	private checkpointPath(jobId: string, version: number): string {
		return join(this.jobDir(jobId), `checkpoint-${version}.json`);
	}

	/**
	 * Get incremental checkpoint path
	 */
	private incrementalPath(jobId: string, version: number): string {
		return join(this.jobDir(jobId), `checkpoint-${version}.delta.json`);
	}

	/**
	 * Get index file path
	 */
	private indexPath(jobId: string): string {
		return join(this.jobDir(jobId), "index.json");
	}

	/**
	 * Generate checksum for data
	 */
	async generateChecksum(data: string): Promise<string> {
		return createHash(this.checksumAlgorithm).update(data).digest("hex");
	}

	/**
	 * Verify checksum
	 */
	async verifyChecksum(data: string, expected: string): Promise<boolean> {
		const actual = await this.generateChecksum(data);
		return actual === expected;
	}

	/**
	 * Compress data using simple encoding (in production, use zlib)
	 */
	private async compress(data: string): Promise<string> {
		// Simple Base64 encoding as placeholder
		// In production, use: import { gzip, gunzip } from 'zlib' and convert to base64
		return Buffer.from(data).toString("base64");
	}

	/**
	 * Decompress data
	 */
	private async decompress(data: string): Promise<string> {
		// In production, use: import { gzip, gunzip } from 'zlib'
		return Buffer.from(data, "base64").toString("utf-8");
	}

	/**
	 * Load index for a job
	 */
	async loadIndex(jobId: string): Promise<CheckpointIndex | null> {
		const path = this.indexPath(jobId);
		try {
			const content = await readFile(path, "utf-8");
			return JSON.parse(content) as CheckpointIndex;
		} catch {
			return null;
		}
	}

	/**
	 * Save index for a job
	 */
	async saveIndex(jobId: string, index: CheckpointIndex): Promise<void> {
		const path = this.indexPath(jobId);
		await this.ensureDir(dirname(path));
		await writeFile(path, JSON.stringify(index, null, 2), "utf-8");
		this.indices.set(jobId, index);
	}

	/**
	 * Get or create index for a job
	 */
	async getOrCreateIndex(jobId: string): Promise<CheckpointIndex> {
		const cached = this.indices.get(jobId);
		if (cached) return cached;

		const loaded = await this.loadIndex(jobId);
		if (loaded) {
			this.indices.set(jobId, loaded);
			return loaded;
		}

		const newIndex: CheckpointIndex = {
			jobId,
			entries: [],
			currentVersion: 0,
			lastUpdated: new Date().toISOString(),
		};
		await this.saveIndex(jobId, newIndex);
		return newIndex;
	}

	/**
	 * Save a full checkpoint
	 */
	async saveFullCheckpoint(checkpoint: FullCheckpoint): Promise<void> {
		const { jobId, version, state, metadata } = checkpoint;
		const dir = this.jobDir(jobId);
		await this.ensureDir(dir);

		// Serialize state
		const jsonData = JSON.stringify(state);
		const checksum = await this.generateChecksum(jsonData);

		// Compress if enabled
		const data = this.compression ? await this.compress(jsonData) : jsonData;

		// Create checkpoint file
		const checkpointFile: CheckpointFile = {
			jobId,
			version,
			type: "full",
			data,
			metadata: {
				...metadata,
				checksum,
				compressed: this.compression,
				sizeBytes: Buffer.byteLength(data),
			},
		};

		// Write with atomic rename
		const path = this.checkpointPath(jobId, version);
		const tmpPath = `${path}.tmp`;
		await writeFile(tmpPath, JSON.stringify(checkpointFile, null, 2), "utf-8");
		await rename(tmpPath, path);

		// Update index
		const index = await this.getOrCreateIndex(jobId);
		index.entries.push({
			jobId,
			version,
			type: "full",
			path,
			compressed: this.compression,
			checksum,
			size: Buffer.byteLength(data),
			createdAt: metadata.createdAt,
		});
		index.currentVersion = version;
		index.lastUpdated = new Date().toISOString();
		await this.saveIndex(jobId, index);
	}

	/**
	 * Save an incremental checkpoint
	 */
	async saveIncrementalCheckpoint(
		checkpoint: IncrementalCheckpoint,
	): Promise<void> {
		const { jobId, version, delta, metadata } = checkpoint;
		const dir = this.jobDir(jobId);
		await this.ensureDir(dir);

		// Serialize delta
		const jsonData = JSON.stringify(delta);
		const checksum = await this.generateChecksum(jsonData);

		// Compress if enabled
		const data = this.compression ? await this.compress(jsonData) : jsonData;

		// Create checkpoint file
		const checkpointFile: CheckpointFile = {
			jobId,
			version,
			type: "incremental",
			data,
			metadata: {
				...metadata,
				checksum,
				compressed: this.compression,
				sizeBytes: Buffer.byteLength(data),
				baseVersion: delta.baseVersion,
			},
		};

		// Write with atomic rename
		const path = this.incrementalPath(jobId, version);
		const tmpPath = `${path}.tmp`;
		await writeFile(tmpPath, JSON.stringify(checkpointFile, null, 2), "utf-8");
		await rename(tmpPath, path);

		// Update index
		const index = await this.getOrCreateIndex(jobId);
		index.entries.push({
			jobId,
			version,
			type: "incremental",
			path,
			compressed: this.compression,
			checksum,
			size: Buffer.byteLength(data),
			createdAt: metadata.createdAt,
			baseVersion: delta.baseVersion,
		});
		index.currentVersion = version;
		index.lastUpdated = new Date().toISOString();
		await this.saveIndex(jobId, index);
	}

	/**
	 * Load a checkpoint by version
	 */
	async loadCheckpoint(
		jobId: string,
		version: number,
	): Promise<FullCheckpoint | IncrementalCheckpoint | null> {
		// Try full checkpoint first (only if it's actually a full checkpoint)
		const fullPath = this.checkpointPath(jobId, version);
		try {
			const content = await readFile(fullPath, "utf-8");
			const file = JSON.parse(content) as CheckpointFile;

			if (file.type !== "full") {
				// Not a full checkpoint at this path — fall through to incremental
				throw new Error("Not a full checkpoint");
			}

			let data = file.data;
			if (file.metadata.compressed) {
				data = await this.decompress(data);
			}

			// Verify checksum
			const checksum = await this.generateChecksum(data);
			if (checksum !== file.metadata.checksum) {
				throw new Error(`Checksum mismatch for checkpoint ${version}`);
			}

			const state = JSON.parse(data);

			return {
				jobId,
				version,
				type: "full" as const,
				state,
				metadata: file.metadata,
			} as FullCheckpoint;
		} catch (fullError) {
			// Try incremental checkpoint
			const incPath = this.incrementalPath(jobId, version);
			try {
				const content = await readFile(incPath, "utf-8");
				const file = JSON.parse(content) as CheckpointFile;

				let data = file.data;
				if (file.metadata.compressed) {
					data = await this.decompress(data);
				}

				const checksum = await this.generateChecksum(data);
				if (checksum !== file.metadata.checksum) {
					throw new Error(
						`Checksum mismatch for incremental checkpoint ${version}`,
					);
				}

				const delta = JSON.parse(data);

				return {
					jobId,
					version,
					type: "incremental" as const,
					delta,
					metadata: file.metadata,
				} as IncrementalCheckpoint;
			} catch {
				// Neither found
				return null;
			}
		}
	}

	/**
	 * List all checkpoints for a job
	 */
	async listCheckpoints(jobId: string): Promise<CheckpointMetadata[]> {
		const index = await this.loadIndex(jobId);
		if (!index) return [];

		return index.entries
			.map((entry) => ({
				jobId: entry.jobId,
				version: entry.version,
				type: entry.type,
				sizeBytes: entry.size,
				compressed: entry.compressed,
				checksum: entry.checksum,
				taskProgress: { total: 0, completed: 0, failed: 0, running: 0 }, // Would need to load to get actual
				createdAt: entry.createdAt,
				baseVersion: entry.baseVersion,
			}))
			.sort((a, b) => a.version - b.version);
	}

	/**
	 * Delete a checkpoint
	 */
	async deleteCheckpoint(jobId: string, version: number): Promise<void> {
		// Try both paths
		const paths = [
			this.checkpointPath(jobId, version),
			this.incrementalPath(jobId, version),
		];

		for (const path of paths) {
			try {
				await unlink(path);
			} catch {
				// Ignore if not found
			}
		}

		// Update index
		const index = await this.getOrCreateIndex(jobId);
		index.entries = index.entries.filter((e) => e.version !== version);
		if (index.entries.length > 0) {
			index.currentVersion = Math.max(...index.entries.map((e) => e.version));
		} else {
			index.currentVersion = 0;
		}
		index.lastUpdated = new Date().toISOString();
		await this.saveIndex(jobId, index);
	}

	/**
	 * Delete all checkpoints for a job
	 */
	async deleteAllCheckpoints(jobId: string): Promise<void> {
		const dir = this.jobDir(jobId);
		try {
			const files = await readdir(dir);
			await Promise.all(files.map((file) => unlink(join(dir, file))));
		} catch {
			// Ignore if directory doesn't exist
		}

		this.indices.delete(jobId);
	}

	/**
	 * Get file size
	 */
	async getFileSize(path: string): Promise<number> {
		try {
			const stats = await stat(path);
			return stats.size;
		} catch {
			return 0;
		}
	}
}

// ─── Factory Function ────────────────────────────────────────────────────

/**
 * Create a storage manager
 */
export function createStorageManager(
	rootDir: string,
	options?: { compression?: boolean; checksumAlgorithm?: "md5" | "sha256" },
): StorageManager {
	return new StorageManager(rootDir, options);
}

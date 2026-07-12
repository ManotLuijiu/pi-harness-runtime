/**
 * Checkpoint Engine - Storage
 *
 * File I/O with compression and checksum verification.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, stat, unlink, readdir, } from "node:fs/promises";
import { dirname, join } from "node:path";
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    compression: true,
    checksumAlgorithm: "sha256",
};
// ─── Storage Manager ──────────────────────────────────────────────────────
export class StorageManager {
    rootDir;
    compression;
    checksumAlgorithm;
    indices = new Map();
    constructor(rootDir, options = {}) {
        this.rootDir = rootDir;
        this.compression = options.compression ?? DEFAULT_CONFIG.compression;
        this.checksumAlgorithm =
            options.checksumAlgorithm ?? DEFAULT_CONFIG.checksumAlgorithm;
    }
    /**
     * Ensure directory exists
     */
    async ensureDir(dir) {
        await mkdir(dir, { recursive: true });
    }
    /**
     * Get job directory path
     */
    jobDir(jobId) {
        return join(this.rootDir, "jobs", jobId);
    }
    /**
     * Get checkpoint file path
     */
    checkpointPath(jobId, version) {
        return join(this.jobDir(jobId), `checkpoint-${version}.json`);
    }
    /**
     * Get incremental checkpoint path
     */
    incrementalPath(jobId, version) {
        return join(this.jobDir(jobId), `checkpoint-${version}.delta.json`);
    }
    /**
     * Get index file path
     */
    indexPath(jobId) {
        return join(this.jobDir(jobId), "index.json");
    }
    /**
     * Generate checksum for data
     */
    async generateChecksum(data) {
        return createHash(this.checksumAlgorithm).update(data).digest("hex");
    }
    /**
     * Verify checksum
     */
    async verifyChecksum(data, expected) {
        const actual = await this.generateChecksum(data);
        return actual === expected;
    }
    /**
     * Compress data using simple encoding (in production, use zlib)
     */
    async compress(data) {
        // Simple Base64 encoding as placeholder
        // In production, use: import { gzip, gunzip } from 'zlib' and convert to base64
        return Buffer.from(data).toString("base64");
    }
    /**
     * Decompress data
     */
    async decompress(data) {
        // In production, use: import { gzip, gunzip } from 'zlib'
        return Buffer.from(data, "base64").toString("utf-8");
    }
    /**
     * Load index for a job
     */
    async loadIndex(jobId) {
        const path = this.indexPath(jobId);
        try {
            const content = await readFile(path, "utf-8");
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * Save index for a job
     */
    async saveIndex(jobId, index) {
        const path = this.indexPath(jobId);
        await this.ensureDir(dirname(path));
        await writeFile(path, JSON.stringify(index, null, 2), "utf-8");
        this.indices.set(jobId, index);
    }
    /**
     * Get or create index for a job
     */
    async getOrCreateIndex(jobId) {
        const cached = this.indices.get(jobId);
        if (cached)
            return cached;
        const loaded = await this.loadIndex(jobId);
        if (loaded) {
            this.indices.set(jobId, loaded);
            return loaded;
        }
        const newIndex = {
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
    async saveFullCheckpoint(checkpoint) {
        const { jobId, version, state, metadata } = checkpoint;
        const dir = this.jobDir(jobId);
        await this.ensureDir(dir);
        // Serialize state
        const jsonData = JSON.stringify(state);
        const checksum = await this.generateChecksum(jsonData);
        // Compress if enabled
        const data = this.compression ? await this.compress(jsonData) : jsonData;
        // Create checkpoint file
        const checkpointFile = {
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
    async saveIncrementalCheckpoint(checkpoint) {
        const { jobId, version, delta, metadata } = checkpoint;
        const dir = this.jobDir(jobId);
        await this.ensureDir(dir);
        // Serialize delta
        const jsonData = JSON.stringify(delta);
        const checksum = await this.generateChecksum(jsonData);
        // Compress if enabled
        const data = this.compression ? await this.compress(jsonData) : jsonData;
        // Create checkpoint file
        const checkpointFile = {
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
    async loadCheckpoint(jobId, version) {
        // Try full checkpoint first (only if it's actually a full checkpoint)
        const fullPath = this.checkpointPath(jobId, version);
        try {
            const content = await readFile(fullPath, "utf-8");
            const file = JSON.parse(content);
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
                type: "full",
                state,
                metadata: file.metadata,
            };
        }
        catch (fullError) {
            // Try incremental checkpoint
            const incPath = this.incrementalPath(jobId, version);
            try {
                const content = await readFile(incPath, "utf-8");
                const file = JSON.parse(content);
                let data = file.data;
                if (file.metadata.compressed) {
                    data = await this.decompress(data);
                }
                const checksum = await this.generateChecksum(data);
                if (checksum !== file.metadata.checksum) {
                    throw new Error(`Checksum mismatch for incremental checkpoint ${version}`);
                }
                const delta = JSON.parse(data);
                return {
                    jobId,
                    version,
                    type: "incremental",
                    delta,
                    metadata: file.metadata,
                };
            }
            catch {
                // Neither found
                return null;
            }
        }
    }
    /**
     * List all checkpoints for a job
     */
    async listCheckpoints(jobId) {
        const index = await this.loadIndex(jobId);
        if (!index)
            return [];
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
    async deleteCheckpoint(jobId, version) {
        // Try both paths
        const paths = [
            this.checkpointPath(jobId, version),
            this.incrementalPath(jobId, version),
        ];
        for (const path of paths) {
            try {
                await unlink(path);
            }
            catch {
                // Ignore if not found
            }
        }
        // Update index
        const index = await this.getOrCreateIndex(jobId);
        index.entries = index.entries.filter((e) => e.version !== version);
        if (index.entries.length > 0) {
            index.currentVersion = Math.max(...index.entries.map((e) => e.version));
        }
        else {
            index.currentVersion = 0;
        }
        index.lastUpdated = new Date().toISOString();
        await this.saveIndex(jobId, index);
    }
    /**
     * Delete all checkpoints for a job
     */
    async deleteAllCheckpoints(jobId) {
        const dir = this.jobDir(jobId);
        try {
            const files = await readdir(dir);
            await Promise.all(files.map((file) => unlink(join(dir, file))));
        }
        catch {
            // Ignore if directory doesn't exist
        }
        this.indices.delete(jobId);
    }
    /**
     * Get file size
     */
    async getFileSize(path) {
        try {
            const stats = await stat(path);
            return stats.size;
        }
        catch {
            return 0;
        }
    }
}
// ─── Factory Function ────────────────────────────────────────────────────
/**
 * Create a storage manager
 */
export function createStorageManager(rootDir, options) {
    return new StorageManager(rootDir, options);
}
//# sourceMappingURL=storage.js.map
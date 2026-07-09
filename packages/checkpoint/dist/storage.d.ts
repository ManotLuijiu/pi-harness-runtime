/**
 * Checkpoint Engine - Storage
 *
 * File I/O with compression and checksum verification.
 */
import type { CheckpointIndex, CheckpointMetadata, FullCheckpoint, IncrementalCheckpoint } from "./types.js";
export declare class StorageManager {
    private readonly rootDir;
    private readonly compression;
    private readonly checksumAlgorithm;
    private indices;
    constructor(rootDir: string, options?: {
        compression?: boolean;
        checksumAlgorithm?: "md5" | "sha256";
    });
    /**
     * Ensure directory exists
     */
    private ensureDir;
    /**
     * Get job directory path
     */
    private jobDir;
    /**
     * Get checkpoint file path
     */
    private checkpointPath;
    /**
     * Get incremental checkpoint path
     */
    private incrementalPath;
    /**
     * Get index file path
     */
    private indexPath;
    /**
     * Generate checksum for data
     */
    generateChecksum(data: string): Promise<string>;
    /**
     * Verify checksum
     */
    verifyChecksum(data: string, expected: string): Promise<boolean>;
    /**
     * Compress data using simple encoding (in production, use zlib)
     */
    private compress;
    /**
     * Decompress data
     */
    private decompress;
    /**
     * Load index for a job
     */
    loadIndex(jobId: string): Promise<CheckpointIndex | null>;
    /**
     * Save index for a job
     */
    saveIndex(jobId: string, index: CheckpointIndex): Promise<void>;
    /**
     * Get or create index for a job
     */
    getOrCreateIndex(jobId: string): Promise<CheckpointIndex>;
    /**
     * Save a full checkpoint
     */
    saveFullCheckpoint(checkpoint: FullCheckpoint): Promise<void>;
    /**
     * Save an incremental checkpoint
     */
    saveIncrementalCheckpoint(checkpoint: IncrementalCheckpoint): Promise<void>;
    /**
     * Load a checkpoint by version
     */
    loadCheckpoint(jobId: string, version: number): Promise<FullCheckpoint | IncrementalCheckpoint | null>;
    /**
     * List all checkpoints for a job
     */
    listCheckpoints(jobId: string): Promise<CheckpointMetadata[]>;
    /**
     * Delete a checkpoint
     */
    deleteCheckpoint(jobId: string, version: number): Promise<void>;
    /**
     * Delete all checkpoints for a job
     */
    deleteAllCheckpoints(jobId: string): Promise<void>;
    /**
     * Get file size
     */
    getFileSize(path: string): Promise<number>;
}
/**
 * Create a storage manager
 */
export declare function createStorageManager(rootDir: string, options?: {
    compression?: boolean;
    checksumAlgorithm?: "md5" | "sha256";
}): StorageManager;
//# sourceMappingURL=storage.d.ts.map
/**
 * Legacy Checkpoint Manager
 *
 * @deprecated Use CheckpointEngine instead
 */
export declare class JsonCheckpointManager {
    private readonly rootDir;
    constructor(rootDir: string);
    /**
     * Get the root directory
     */
    getRootDir(): string;
    /**
     * @deprecated Use CheckpointEngine.save() instead
     */
    save(_checkpoint: unknown): Promise<void>;
    /**
     * @deprecated Use CheckpointEngine.load() instead
     */
    load(_jobId: string): Promise<unknown | null>;
}
//# sourceMappingURL=checkpoint-manager.d.ts.map
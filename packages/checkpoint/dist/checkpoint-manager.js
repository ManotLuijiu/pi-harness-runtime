/**
 * Legacy Checkpoint Manager
 *
 * @deprecated Use CheckpointEngine instead
 */
export class JsonCheckpointManager {
    // NOTE: an explicit field (not a constructor parameter property) so the
    // module can be loaded by Node's type-stripping loader, which rejects
    // parameter properties ("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX").
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    /**
     * Get the root directory
     */
    getRootDir() {
        return this.rootDir;
    }
    /**
     * @deprecated Use CheckpointEngine.save() instead
     */
    async save(_checkpoint) {
        throw new Error("Legacy JsonCheckpointManager is deprecated. Use CheckpointEngine instead.");
    }
    /**
     * @deprecated Use CheckpointEngine.load() instead
     */
    async load(_jobId) {
        throw new Error("Legacy JsonCheckpointManager is deprecated. Use CheckpointEngine instead.");
    }
}
//# sourceMappingURL=checkpoint-manager.js.map
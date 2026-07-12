/**
 * Legacy Checkpoint Manager
 *
 * @deprecated Use CheckpointEngine instead
 */
export class JsonCheckpointManager {
	constructor(private readonly rootDir: string) {}

	/**
	 * Get the root directory
	 */
	getRootDir(): string {
		return this.rootDir;
	}

	/**
	 * @deprecated Use CheckpointEngine.save() instead
	 */
	async save(_checkpoint: unknown): Promise<void> {
		throw new Error(
			"Legacy JsonCheckpointManager is deprecated. Use CheckpointEngine instead.",
		);
	}

	/**
	 * @deprecated Use CheckpointEngine.load() instead
	 */
	async load(_jobId: string): Promise<unknown | null> {
		throw new Error(
			"Legacy JsonCheckpointManager is deprecated. Use CheckpointEngine instead.",
		);
	}
}

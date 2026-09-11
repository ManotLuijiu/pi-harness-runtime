/**
 * File-based checkpointer — persists LangGraph StateGraph checkpoints to disk.
 *
 * Enables crash-safe loop resume: if the daemon dies mid-task, a new instance
 * resumes from the last checkpoint instead of restarting from scratch.
 *
 * Storage layout:
 *   <root>/
 *   ├── <threadId>/
 *   │   ├── index.jsonl      # one line per checkpoint (id, ts, parentId, step)
 *   │   └── <checkpointId>.json  # full checkpoint + metadata + parentConfig
 *
 * Wiki: wiki/auto-trigger-multi-agent.md §M5
 */
import { BaseCheckpointSaver, Checkpoint, CheckpointListOptions, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph-checkpoint";
import type { ChannelVersions } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
/**
 * File-based LangGraph checkpointer. Implements BaseCheckpointSaver so it can be
 * passed directly to `buildWriteReviewLoop()` as the `checkpointer` option.
 *
 * Usage:
 *   const saver = new FileCheckpointSaver({ root: "/tmp/checkpoints" });
 *   const loop = buildWriteReviewLoop(deps, { checkpointer: saver });
 *
 * On daemon restart, pass the same root — checkpoints persist across restarts.
 */
export declare class FileCheckpointSaver extends BaseCheckpointSaver {
    private readonly root;
    constructor(opts: {
        root: string;
    });
    get(config: RunnableConfig): Promise<Checkpoint | undefined>;
    getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined>;
    private _loadCheckpoint;
    list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple>;
    put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig>;
    putWrites(_config: RunnableConfig, _writes: [], _taskId: string): Promise<void>;
    deleteThread(threadId: string): Promise<void>;
    toJSON(): string;
    /** List all known thread IDs with saved checkpoints. */
    listThreads(): string[];
    /** Delete all checkpoints for all threads (cleanup). */
    clearAll(): void;
}
/** Build a FileCheckpointSaver wired to the daemon's workspace. */
export declare function createLoopCheckpointer(workspace: string): FileCheckpointSaver;
//# sourceMappingURL=checkpointer.d.ts.map
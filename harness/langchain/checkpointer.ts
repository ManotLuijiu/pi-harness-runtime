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

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
	BaseCheckpointSaver,
	Checkpoint,
	CheckpointListOptions,
	CheckpointMetadata,
	CheckpointTuple,
} from "@langchain/langgraph-checkpoint";
import type { ChannelVersions } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal JSON serializer compatible with SerializerProtocol. */
const jsonSerializer = {
	async dumpsTyped(data: unknown): Promise<[string, Uint8Array]> {
		return ["application/json", new TextEncoder().encode(JSON.stringify(data))];
	},
	async loadsTyped(
		_type: string,
		data: Uint8Array | string,
	): Promise<unknown> {
		try {
			const bytes: Uint8Array =
				typeof data === "string" ? new TextEncoder().encode(data) : data;
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new Error("Failed to deserialize checkpoint data");
		}
	},
} as const;

// ─── Storage helpers ────────────────────────────────────────────────────────

interface IndexEntry {
	id: string;
	ts: string;
	parentId?: string;
	step: number;
}

function threadDir(root: string, threadId: string): string {
	return join(root, `thread-${threadId}`);
}

function checkpointPath(threadDir: string, checkpointId: string): string {
	return join(threadDir, `${checkpointId}.json`);
}

function indexPath(threadDir: string): string {
	return join(threadDir, "index.jsonl");
}

function ensureThreadDir(root: string, threadId: string): string {
	const dir = threadDir(root, threadId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function readIndex(threadDir: string): IndexEntry[] {
	const path = indexPath(threadDir);
	if (!existsSync(path)) return [];
	try {
		return readFileSync(path, "utf8")
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l) as IndexEntry);
	} catch {
		return [];
	}
}

function appendIndex(threadDir: string, entry: IndexEntry): void {
	const path = indexPath(threadDir);
	const line = JSON.stringify(entry) + "\n";
	if (existsSync(path)) {
		const fd = require("node:fs").openSync(path, "a");
		require("node:fs").writeSync(fd, line);
		require("node:fs").closeSync(fd);
	} else {
		writeFileSync(path, line, "utf8");
	}
}

function atomicWrite(path: string, content: string): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, path);
}

// ─── FileCheckpointSaver ──────────────────────────────────────────────────────

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
export class FileCheckpointSaver extends BaseCheckpointSaver {
private readonly root: string;

constructor(opts: { root: string }) {
super(jsonSerializer);
this.root = opts.root;
}

	// ─── BaseCheckpointSaver ─────────────────────────────────────────────

	async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
		const tuple = await this.getTuple(config);
		return tuple?.checkpoint;
	}

	async getTuple(
		config: RunnableConfig,
	): Promise<CheckpointTuple | undefined> {
		const threadId = String(config.configurable?.thread_id ?? "");
		if (!threadId) return undefined;

		const dir = threadDir(this.root, threadId);
		if (!existsSync(dir)) return undefined;

		const checkpointId = String(config.configurable?.checkpoint_id ?? "");
		if (!checkpointId) {
			const index = readIndex(dir);
			if (index.length === 0) return undefined;
			return this._loadCheckpoint(config, dir, index[index.length - 1].id);
		}

		return this._loadCheckpoint(config, dir, checkpointId);
	}

	private async _loadCheckpoint(
		config: RunnableConfig,
		dir: string,
		checkpointId: string,
	): Promise<CheckpointTuple | undefined> {
		const path = checkpointPath(dir, checkpointId);
		if (!existsSync(path)) return undefined;

		try {
			const raw = readFileSync(path);
			const data = JSON.parse(
				new TextDecoder().decode(raw),
			) as {
				checkpoint: Checkpoint;
				metadata: CheckpointMetadata;
				parentConfig?: RunnableConfig;
			};

			const index = readIndex(dir);
			const entry = index.find((e) => e.id === checkpointId);
			const parentId = entry?.parentId;

			let parentConfig: RunnableConfig | undefined;
			if (
				parentId &&
				existsSync(checkpointPath(dir, parentId))
			) {
				parentConfig = {
					configurable: {
						thread_id: config.configurable?.thread_id,
						checkpoint_id: parentId,
					},
				};
			}

			return {
				config,
				checkpoint: data.checkpoint,
				metadata: data.metadata,
				parentConfig: parentConfig ?? data.parentConfig,
			};
		} catch {
				return undefined;
		}
	}

	async *list(
		config: RunnableConfig,
		options?: CheckpointListOptions,
	): AsyncGenerator<CheckpointTuple> {
		const threadId = String(config.configurable?.thread_id ?? "");
		if (!threadId) return;

		const dir = threadDir(this.root, threadId);
		if (!existsSync(dir)) return;

		const index = [...readIndex(dir)].sort((a, b) =>
			b.ts.localeCompare(a.ts),
		);

		const limit = options?.limit ?? 100;
		let count = 0;

		for (const entry of index) {
			if (count >= limit) break;
			const tuple = await this._loadCheckpoint(config, dir, entry.id);
			if (tuple) yield tuple;
			count++;
		}
	}

	async put(
		config: RunnableConfig,
		checkpoint: Checkpoint,
		metadata: CheckpointMetadata,
		_newVersions: ChannelVersions,
	): Promise<RunnableConfig> {
		const threadId = String(config.configurable?.thread_id ?? "");
		if (!threadId) throw new Error("thread_id is required for checkpointing");

		const dir = ensureThreadDir(this.root, threadId);
		const parentId = (metadata.parents as Record<string, string | undefined>)?.[""];

		const path = checkpointPath(dir, checkpoint.id);
		atomicWrite(
			path,
			JSON.stringify({
				checkpoint,
				metadata,
				parentConfig: parentId
					? { configurable: { thread_id: threadId, checkpoint_id: parentId } }
					: undefined,
			}),
		);

		appendIndex(dir, {
			id: checkpoint.id,
			ts: checkpoint.ts,
			parentId,
			step: metadata.step,
		});

		return {
			configurable: { ...config.configurable, checkpoint_id: checkpoint.id },
		};
	}

	async putWrites(
		_config: RunnableConfig,
		_writes: [],
		_taskId: string,
	): Promise<void> {
		// Pending writes stored inline in the checkpoint JSON — no separate file needed.
	}

	async deleteThread(threadId: string): Promise<void> {
		const dir = threadDir(this.root, threadId);
		if (!existsSync(dir)) return;

		for (const file of readdirSync(dir)) {
			try {
				unlinkSync(join(dir, file));
			} catch {
				/* ignore */
			}
		}

		try {
			require("node:fs").rmdirSync(dir);
		} catch {
			/* ignore */
		}
	}

	toJSON(): string {
		return "FileCheckpointSaver";
	}

	// ─── Inherited defaults from BaseCheckpointSaver ───────────────────────

	// getDeltaChannelHistory: uses the default implementation (walks getTuple chain)
	// getNextVersion: uses the default integer implementation

	// ─── Helpers ───────────────────────────────────────────────────────

	/** List all known thread IDs with saved checkpoints. */
	listThreads(): string[] {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root)
			.filter((f) => f.startsWith("thread-"))
			.map((f) => f.replace("thread-", ""));
	}

	/** Delete all checkpoints for all threads (cleanup). */
	clearAll(): void {
		if (!existsSync(this.root)) return;
		for (const thread of readdirSync(this.root)) {
			const fullPath = join(this.root, thread);
			if (!existsSync(fullPath)) continue;
			for (const file of readdirSync(fullPath)) {
				try {
					unlinkSync(join(fullPath, file));
				} catch {
					/* ignore */
				}
			}
			try {
				require("node:fs").rmdirSync(fullPath);
			} catch {
				/* ignore */
			}
		}
	}
}

// ─── Factory ────────────────────────────────────────────────────────────────

/** Build a FileCheckpointSaver wired to the daemon's workspace. */
export function createLoopCheckpointer(workspace: string): FileCheckpointSaver {
	const root = join(workspace, ".checkpoints");
	return new FileCheckpointSaver({ root });
}

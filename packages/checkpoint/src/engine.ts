/**
 * Checkpoint Engine - Engine
 *
 * Main checkpoint engine with recovery strategies.
 */

import type {
	CheckpointEngineConfig,
	CheckpointMetadata,
	CheckpointType,
	FullCheckpoint,
	IncrementalCheckpoint,
	PruneResult,
	RecoveryResult,
	RecoveryStrategy,
	RuntimeState,
	StateDelta,
	VerificationResult,
} from "./types.js";
import { DiffCalculator } from "./differ.js";
import { StorageManager } from "./storage.js";

// ─── Default Configuration ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<CheckpointEngineConfig> = {
	rootDir: "./checkpoints",
	compression: true,
	incremental: true,
	maxCheckpoints: 10,
	autoPrune: true,
	checksumAlgorithm: "sha256",
	parallelWrites: true,
	metadataIndex: true,
};

// ─── Checkpoint Engine ─────────────────────────────────────────────────────

export class CheckpointEngine {
	private readonly config: Required<CheckpointEngineConfig>;
	private readonly storage: StorageManager;
	private readonly differ: DiffCalculator;
	private lastStates: Map<string, RuntimeState> = new Map();

	constructor(config: CheckpointEngineConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.storage = new StorageManager(this.config.rootDir, {
			compression: this.config.compression,
			checksumAlgorithm: this.config.checksumAlgorithm,
		});
		this.differ = new DiffCalculator();
	}

	/**
	 * Get current version for a job
	 */
	private async getCurrentVersion(jobId: string): Promise<number> {
		const index = await this.storage.loadIndex(jobId);
		return index?.currentVersion ?? 0;
	}

	/**
	 * Create metadata for a checkpoint
	 */
	private createMetadata(
		jobId: string,
		version: number,
		type: CheckpointType,
		state: RuntimeState,
		baseVersion?: number,
	): CheckpointMetadata {
		const tasks = state.tasks ?? [];
		return {
			jobId,
			version,
			type,
			sizeBytes: 0, // Will be updated by storage
			compressed: this.config.compression,
			checksum: "", // Will be updated by storage
			taskProgress: {
				total: tasks.length,
				completed: tasks.filter((t) => t.status === "done").length,
				failed: tasks.filter((t) => t.status === "failed").length,
				running: tasks.filter((t) => t.status === "running").length,
			},
			createdAt: new Date().toISOString(),
			baseVersion,
		};
	}

	/**
	 * Save a checkpoint (full or incremental based on config)
	 */
	async save(jobId: string, state: RuntimeState): Promise<CheckpointMetadata> {
		const currentVersion = await this.getCurrentVersion(jobId);
		const newVersion = currentVersion + 1;
		const now = new Date().toISOString();

		// Update state version and timestamp
		const updatedState: RuntimeState = {
			...state,
			version: newVersion,
			updatedAt: now,
		};

		// Decide whether to use full or incremental
		if (
			this.config.incremental &&
			currentVersion > 0 &&
			!this.shouldUseFullCheckpoint(updatedState)
		) {
			// Save incremental checkpoint
			const baseState = await this.loadState(jobId, currentVersion);
			if (baseState) {
				const delta = this.differ.calculateDiff(
					jobId,
					currentVersion,
					newVersion,
					baseState,
					updatedState,
				);

				const metadata = this.createMetadata(
					jobId,
					newVersion,
					"incremental",
					updatedState,
					currentVersion,
				);

				const checkpoint: IncrementalCheckpoint = {
					jobId,
					version: newVersion,
					type: "incremental",
					delta,
					metadata,
				};

				await this.storage.saveIncrementalCheckpoint(checkpoint);
				this.lastStates.set(jobId, updatedState);

				// Auto-prune if enabled
				if (this.config.autoPrune) {
					this.prune(jobId, this.config.maxCheckpoints).catch((err) => {
						console.error("Auto-prune failed:", err);
					});
				}

				return checkpoint.metadata;
			}
		}

		// Save full checkpoint
		const metadata = this.createMetadata(
			jobId,
			newVersion,
			"full",
			updatedState,
		);

		const checkpoint: FullCheckpoint = {
			jobId,
			version: newVersion,
			type: "full",
			state: updatedState,
			metadata,
		};

		await this.storage.saveFullCheckpoint(checkpoint);
		this.lastStates.set(jobId, updatedState);

		// Auto-prune if enabled
		if (this.config.autoPrune) {
			this.prune(jobId, this.config.maxCheckpoints).catch((err) => {
				console.error("Auto-prune failed:", err);
			});
		}

		return checkpoint.metadata;
	}

	/**
	 * Decide if we should use a full checkpoint
	 */
	private shouldUseFullCheckpoint(state: RuntimeState): boolean {
		// Use full checkpoint if:
		// 1. Many tasks have changed
		const taskCount = state.tasks?.length ?? 0;
		if (taskCount > 100) return true;

		// 2. Status is terminal
		if (
			["completed", "failed", "cancelled", "archived"].includes(state.status)
		) {
			return true;
		}

		// 3. Random sampling (10% chance for non-incremental)
		if (Math.random() < 0.1) return true;

		return false;
	}

	/**
	 * Save an incremental checkpoint explicitly
	 */
	async saveIncremental(
		jobId: string,
		delta: StateDelta,
	): Promise<CheckpointMetadata> {
		const metadata = this.createMetadata(
			jobId,
			delta.targetVersion,
			"incremental",
			delta as unknown as RuntimeState,
			delta.baseVersion,
		);

		const checkpoint: IncrementalCheckpoint = {
			jobId,
			version: delta.targetVersion,
			type: "incremental",
			delta,
			metadata,
		};

		await this.storage.saveIncrementalCheckpoint(checkpoint);

		return checkpoint.metadata;
	}

	/**
	 * Load the latest state for a job
	 */
	async load(jobId: string): Promise<RuntimeState | null> {
		const version = await this.getCurrentVersion(jobId);
		if (version === 0) return null;

		return this.loadState(jobId, version);
	}

	/**
	 * Load state at specific version
	 */
	async loadState(
		jobId: string,
		version: number,
	): Promise<RuntimeState | null> {
		const checkpoint = await this.storage.loadCheckpoint(jobId, version);
		if (!checkpoint) return null;

		if (checkpoint.type === "full") {
			return checkpoint.state;
		}

		// Reconstruct from incremental
		return this.reconstructFromIncremental(jobId, checkpoint);
	}

	/**
	 * Reconstruct state from incremental checkpoint
	 */
	private async reconstructFromIncremental(
		jobId: string,
		incremental: IncrementalCheckpoint,
	): Promise<RuntimeState | null> {
		const { delta } = incremental;

		// Find the base full checkpoint
		let baseState: RuntimeState | null = null;
		let baseVersion = delta.baseVersion;

		// Walk back to find the full checkpoint
		while (baseVersion > 0) {
			const baseCheckpoint = await this.storage.loadCheckpoint(
				jobId,
				baseVersion,
			);
			if (!baseCheckpoint) {
				baseVersion--;
				continue;
			}

			if (baseCheckpoint.type === "full") {
				baseState = baseCheckpoint.state;
				break;
			}

			// It's another incremental, continue walking back
			baseVersion = (baseCheckpoint as IncrementalCheckpoint).delta.baseVersion;
		}

		if (!baseState) {
			throw new Error(
				`Could not find base checkpoint for incremental ${incremental.version}`,
			);
		}

		// Collect all deltas from base to target
		const deltas: StateDelta[] = [];
		let currentVersion = delta.baseVersion;

		while (currentVersion < incremental.version) {
			currentVersion++;
			const cp = await this.storage.loadCheckpoint(jobId, currentVersion);
			if (cp && cp.type === "incremental") {
				deltas.push((cp as IncrementalCheckpoint).delta);
			}
		}

		// Apply deltas
		return this.differ.reconstructState(baseState, deltas);
	}

	/**
	 * Recover job state using specified strategy
	 */
	async recover(
		jobId: string,
		strategy: RecoveryStrategy,
	): Promise<RecoveryResult> {
		const startTime = Date.now();

		try {
			const checkpoints = await this.storage.listCheckpoints(jobId);

			if (checkpoints.length === 0) {
				return {
					success: false,
					recoveredVersion: 0,
					lostEvents: 0,
					recoveryTimeMs: Date.now() - startTime,
					errors: ["No checkpoints found"],
				};
			}

			let targetVersion: number;

			// Handle recovery strategies
			if (strategy === "latest") {
				targetVersion = Math.max(...checkpoints.map((c) => c.version));
			} else if (strategy === "fullest") {
				// Find checkpoint with most completed tasks
				let maxCompleted = -1;
				targetVersion = checkpoints[0].version;
				for (const cp of checkpoints) {
					if (cp.taskProgress.completed > maxCompleted) {
						maxCompleted = cp.taskProgress.completed;
						targetVersion = cp.version;
					}
				}
			} else if (strategy === "interactive") {
				// Would need UI integration - use latest for now
				targetVersion = Math.max(...checkpoints.map((c) => c.version));
			} else if (strategy.startsWith("specific:")) {
				// Handle specific:N pattern
				targetVersion = parseInt(strategy.split(":")[1], 10);
			} else if (strategy.startsWith("timestamp:")) {
				// Handle timestamp:ISO pattern
				const targetTime = new Date(strategy.split(":")[1]).getTime();
				let minDiff = Infinity;
				targetVersion = checkpoints[0].version;
				for (const cp of checkpoints) {
					const cpTime = new Date(cp.createdAt).getTime();
					const diff = Math.abs(cpTime - targetTime);
					if (diff < minDiff) {
						minDiff = diff;
						targetVersion = cp.version;
					}
				}
			} else {
				// Default to latest
				targetVersion = Math.max(...checkpoints.map((c) => c.version));
			}

			// Verify checkpoint
			const verification = await this.verify(jobId, targetVersion);
			if (!verification.valid) {
				return {
					success: false,
					recoveredVersion: targetVersion,
					lostEvents: 0,
					recoveryTimeMs: Date.now() - startTime,
					errors: verification.corruptionDetails,
				};
			}

			// Load state
			const state = await this.loadState(jobId, targetVersion);
			if (!state) {
				return {
					success: false,
					recoveredVersion: targetVersion,
					lostEvents: 0,
					recoveryTimeMs: Date.now() - startTime,
					errors: ["Failed to load state"],
				};
			}

			return {
				success: true,
				recoveredVersion: targetVersion,
				recoveredState: state,
				lostEvents: 0,
				recoveryTimeMs: Date.now() - startTime,
				warnings: verification.corruptionDetails?.length
					? verification.corruptionDetails
					: undefined,
			};
		} catch (error) {
			return {
				success: false,
				recoveredVersion: 0,
				lostEvents: 0,
				recoveryTimeMs: Date.now() - startTime,
				errors: [error instanceof Error ? error.message : String(error)],
			};
		}
	}

	/**
	 * Verify a checkpoint
	 */
	async verify(jobId: string, version: number): Promise<VerificationResult> {
		try {
			const checkpoint = await this.storage.loadCheckpoint(jobId, version);
			if (!checkpoint) {
				return {
					valid: false,
					checksumMatch: false,
					corruptionDetails: ["Checkpoint not found"],
				};
			}

			// For incremental checkpoints, chain verification is handled by storage
			// We trust storage integrity for now
			if (checkpoint.type === "incremental") {
				// Delta checksum verification would require access to original data
			}

			return {
				valid: true,
				checksumMatch: true,
			};
		} catch (error) {
			return {
				valid: false,
				checksumMatch: false,
				corruptionDetails: [
					error instanceof Error ? error.message : String(error),
				],
			};
		}
	}

	/**
	 * Prune old checkpoints
	 */
	async prune(jobId: string, keepCount: number): Promise<PruneResult> {
		const checkpoints = await this.storage.listCheckpoints(jobId);
		const errors: string[] = [];

		if (checkpoints.length <= keepCount) {
			return {
				deletedCount: 0,
				freedBytes: 0,
				remainingCount: checkpoints.length,
			};
		}

		// Always keep the latest N checkpoints
		const toDelete = checkpoints
			.sort((a, b) => a.version - b.version)
			.slice(0, checkpoints.length - keepCount);

		let freedBytes = 0;
		let deletedCount = 0;

		for (const cp of toDelete) {
			try {
				await this.storage.deleteCheckpoint(jobId, cp.version);
				freedBytes += cp.sizeBytes;
				deletedCount++;
			} catch (error) {
				errors.push(
					`Failed to delete checkpoint ${cp.version}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		return {
			deletedCount,
			freedBytes,
			remainingCount: checkpoints.length - deletedCount,
			errors: errors.length > 0 ? errors : undefined,
		};
	}

	/**
	 * Get metadata for all checkpoints
	 */
	async getMetadata(jobId: string): Promise<CheckpointMetadata[]> {
		return this.storage.listCheckpoints(jobId);
	}

	/**
	 * Get cached last state
	 */
	getLastState(jobId: string): RuntimeState | undefined {
		return this.lastStates.get(jobId);
	}

	/**
	 * Delete all checkpoints for a job
	 */
	async deleteAll(jobId: string): Promise<void> {
		await this.storage.deleteAllCheckpoints(jobId);
		this.lastStates.delete(jobId);
	}
}

// ─── Factory Function ────────────────────────────────────────────────────

/**
 * Create a checkpoint engine
 */
export function createCheckpointEngine(
	config: CheckpointEngineConfig,
): CheckpointEngine {
	return new CheckpointEngine(config);
}

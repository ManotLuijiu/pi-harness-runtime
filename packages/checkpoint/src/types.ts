/**
 * Checkpoint Engine - Types
 *
 * Core types for the enhanced checkpoint system.
 */

// ─── SDK Version ────────────────────────────────────────────────────────────

/**
 * SDK version for compatibility checks
 */
export const SDK_VERSION = "1.0.0";

// ─── Task Types ─────────────────────────────────────────────────────────

/**
 * Task status
 */
export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked";

/**
 * Runtime task
 */
export interface RuntimeTask {
	id: string;
	title: string;
	description: string;
	status: TaskStatus;
	assignedProvider?: string;
	worktreePath?: string;
	acceptanceCriteria?: string[];
}

// ─── Job Types ──────────────────────────────────────────────────────────

/**
 * Job status
 */
export type JobStatus =
	| "pending"
	| "running"
	| "blocked"
	| "completed"
	| "failed"
	| "cancelled"
	| "archived";

// ─── State Types ─────────────────────────────────────────────────────────

/**
 * Runtime state to be checkpointed
 */
export interface RuntimeState {
	version: number;
	jobId: string;
	status: JobStatus;
	requirement: string;
	currentTaskId?: string;
	provider?: string;
	resumeAt?: string;
	lastError?: string;
	tasks: RuntimeTask[];
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

// ─── Checkpoint Types ────────────────────────────────────────────────────

/**
 * Checkpoint type
 */
export type CheckpointType = "full" | "incremental";

/**
 * Checkpoint metadata
 */
export interface CheckpointMetadata {
	jobId: string;
	version: number;
	type: CheckpointType;
	sizeBytes: number;
	compressed: boolean;
	checksum: string;
	taskProgress: {
		total: number;
		completed: number;
		failed: number;
		running: number;
	};
	createdAt: string;
	expiresAt?: string;
	baseVersion?: number; // For incremental checkpoints
}

/**
 * Full checkpoint data
 */
export interface FullCheckpoint {
	jobId: string;
	version: number;
	type: "full";
	state: RuntimeState;
	metadata: CheckpointMetadata;
}

/**
 * State delta for incremental checkpoints
 */
export interface StateDelta {
	jobId: string;
	baseVersion: number;
	targetVersion: number;
	changes: {
		status?: JobStatus;
		tasks?: TaskDelta[];
		context?: ContextDiff;
		errors?: ErrorEntry[];
		metadata?: Record<string, unknown>;
	};
	timestamp: string;
	checksum: string;
}

/**
 * Task delta
 */
export interface TaskDelta {
	taskId: string;
	action: "added" | "updated" | "removed";
	before?: Partial<RuntimeTask>;
	after?: Partial<RuntimeTask>;
}

/**
 * Context diff
 */
export interface ContextDiff {
	added?: Record<string, unknown>;
	removed?: string[];
	updated?: Record<string, { before: unknown; after: unknown }>;
}

/**
 * Error entry
 */
export interface ErrorEntry {
	taskId?: string;
	error: string;
	timestamp: string;
	recoverable: boolean;
}

/**
 * Incremental checkpoint data
 */
export interface IncrementalCheckpoint {
	jobId: string;
	version: number;
	type: "incremental";
	delta: StateDelta;
	metadata: CheckpointMetadata;
}

// ─── Recovery Types ──────────────────────────────────────────────────────

/**
 * Recovery strategy
 */
export type RecoveryStrategy =
	| "latest" // Use most recent checkpoint
	| "fullest" // Use checkpoint with most completed tasks
	| `specific:${number}` // Use specific version number
	| `timestamp:${string}` // Use checkpoint closest to timestamp
	| "interactive"; // User selects from list

/**
 * Recovery result
 */
export interface RecoveryResult {
	success: boolean;
	recoveredVersion: number;
	recoveredState?: RuntimeState;
	lostEvents: number;
	recoveryTimeMs: number;
	errors?: string[];
	warnings?: string[];
}

/**
 * Verification result
 */
export interface VerificationResult {
	valid: boolean;
	checksumMatch: boolean;
	corruptionDetails?: string[];
}

/**
 * Prune result
 */
export interface PruneResult {
	deletedCount: number;
	freedBytes: number;
	remainingCount: number;
	errors?: string[];
}

// ─── Storage Types ───────────────────────────────────────────────────────

/**
 * Checkpoint file stored on disk
 */
export interface CheckpointFile {
	jobId: string;
	version: number;
	type: CheckpointType;
	data: string;
	metadata: CheckpointMetadata;
}

/**
 * Index entry for a checkpoint
 */
export interface IndexEntry {
	jobId: string;
	version: number;
	type: CheckpointType;
	path: string;
	compressed: boolean;
	checksum: string;
	size: number;
	createdAt: string;
	baseVersion?: number;
}

/**
 * Checkpoint index for a job
 */
export interface CheckpointIndex {
	jobId: string;
	entries: IndexEntry[];
	currentVersion: number;
	lastUpdated: string;
}

// ─── Configuration ────────────────────────────────────────────────────────

/**
 * Checkpoint engine configuration
 */
export interface CheckpointEngineConfig {
	/**
	 * Root directory for checkpoint storage
	 */
	rootDir?: string;

	/**
	 * Enable compression for checkpoints
	 */
	compression?: boolean;

	/**
	 * Enable incremental checkpoints
	 */
	incremental?: boolean;

	/**
	 * Maximum number of checkpoints to keep
	 */
	maxCheckpoints?: number;

	/**
	 * Automatically prune old checkpoints on save
	 */
	autoPrune?: boolean;

	/**
	 * Checksum algorithm
	 */
	checksumAlgorithm?: "md5" | "sha256";

	/**
	 * Enable parallel file writes
	 */
	parallelWrites?: boolean;

	/**
	 * Build metadata index
	 */
	metadataIndex?: boolean;
}

// ─── Event Types ─────────────────────────────────────────────────────────

/**
 * Checkpoint event
 */
export interface CheckpointEvent {
	type: "checkpoint" | "recovery" | "prune" | "verify";
	jobId: string;
	version?: number;
	timestamp: string;
	data?: Record<string, unknown>;
}

/**
 * Event log entry
 */
export interface EventLogEntry {
	id: string;
	event: CheckpointEvent;
	correlationId?: string;
}

// ─── Legacy Types ────────────────────────────────────────────────────────

/**
 * Legacy checkpoint format
 */
export interface LegacyCheckpoint {
	version: number;
	jobId: string;
	status: string;
	state: Record<string, unknown>;
	timestamp: string;
}

/**
 * Check if a checkpoint is in legacy format
 */
export function isLegacyCheckpoint(
	checkpoint: unknown,
): checkpoint is LegacyCheckpoint {
	if (typeof checkpoint !== "object" || checkpoint === null) {
		return false;
	}

	const cp = checkpoint as Record<string, unknown>;

	return (
		typeof cp.version === "number" &&
		typeof cp.jobId === "string" &&
		typeof cp.status === "string" &&
		cp.state !== undefined &&
		typeof cp.timestamp === "string"
	);
}

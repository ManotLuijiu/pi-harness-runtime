/**
 * Experience Replay Types (RFC-0059)
 *
 * Interfaces for replaying prior runtime execution.
 */

// ─── Local Type Definitions ───────────────────────────────────────────────

export interface RuntimeEvent {
	ts: string;
	jobId: string;
	type: string;
	message: string;
	data?: Record<string, unknown>;
}

export interface RuntimeCheckpoint {
	version: number;
	jobId: string;
	status: string;
	requirement: string;
	currentTaskId?: string;
	provider?: string;
	resumeAt?: string;
	lastError?: string;
	createdAt: string;
	updatedAt: string;
}

export interface TaskGraphNode {
	id: string;
	title: string;
	description: string;
	status: string;
	dependencies: string[];
}

export interface TaskGraph {
	nodes: TaskGraphNode[];
	edges: Array<{ from: string; to: string }>;
}

// ─── Replay Types ─────────────────────────────────────────────────────────────

export type ReplayMode = "inspect" | "simulate" | "reexecute";

export interface ReplayRequest {
	jobId: string;
	mode: ReplayMode;
	fromSequence?: number;
	toSequence?: number;
	allowExternalCalls: boolean;
}

export interface JobStateSnapshot {
	jobId: string;
	status: string;
	currentTaskId?: string;
	checkpoint: RuntimeCheckpoint;
	taskGraph: TaskGraph;
	events: RuntimeEvent[];
	timestamp: string;
}

export interface ReplayEvent {
	sequence: number;
	timestamp: string;
	type: string;
	data: Record<string, unknown>;
}

export interface ReplayDivergence {
	sequence: number;
	reason: string;
	expected?: unknown;
	actual?: unknown;
	severity: "info" | "warning" | "error";
}

export interface ReplayResult {
	jobId: string;
	reconstructedState: JobStateSnapshot;
	timeline: ReplayEvent[];
	divergences: ReplayDivergence[];
	artifacts: string[];
	replayedAt: string;
}

// ─── Replay Sources ───────────────────────────────────────────────────────────

export interface ReplaySources {
	checkpoint?: RuntimeCheckpoint;
	events?: RuntimeEvent[];
	taskGraph?: TaskGraph;
	prompts?: Record<string, string>;
	outputs?: Record<string, string>;
	testResults?: Record<string, unknown>;
	evaluation?: Record<string, unknown>;
	repairs?: Record<string, unknown>;
	knowledgeRefs?: string[];
	/** Filter events by sequence range */
	fromSequence?: number;
	toSequence?: number;
}

// ─── Divergence Detection ─────────────────────────────────────────────────────

export type DivergenceReason =
	| "source_file_changed"
	| "project_rules_changed"
	| "provider_output_differs"
	| "test_environment_changed"
	| "required_artifact_missing"
	| "runtime_version_differs";

export interface DivergenceCheck {
	type: DivergenceReason;
	check: () => Promise<boolean>;
	severity: "info" | "warning" | "error";
}

// ─── Runtime Events ───────────────────────────────────────────────────────────

export type ReplayRuntimeEvent =
	| { type: "replay.started"; jobId: string; mode: ReplayMode }
	| { type: "replay.state.reconstructed"; jobId: string; sequence: number }
	| { type: "replay.divergence.detected"; jobId: string; reason: string }
	| { type: "replay.completed"; jobId: string };

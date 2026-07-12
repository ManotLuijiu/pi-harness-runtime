/**
 * Agent Worker Interface — RFC-0030
 *
 * Common interface for all agent workers (Codex, MiniMax, GLM, GPT, DeepAgents).
 * Runtime remains the orchestrator; agents are pluggable workers.
 */

import type { RuntimeTask } from "./runtime-types.js";

// ─── Agent Worker Types ───────────────────────────────────────────────

export type AgentStatus =
	| "idle"
	| "initializing"
	| "running"
	| "paused"
	| "stopped"
	| "error";

export type TaskResultStatus = "success" | "failure" | "partial" | "cancelled";

export interface AgentWorkerConfig {
	/** Unique identifier for this worker instance */
	readonly id: string;
	/** Provider name (e.g., "codex", "minimax", "glm", "gpt", "deepagents") */
	readonly provider: string;
	/** API endpoint or connection string */
	readonly endpoint?: string;
	/** Authentication token */
	readonly apiKey?: string;
	/** Default model to use */
	readonly defaultModel?: string;
	/** Supported models */
	readonly supportedModels?: string[];
	/** Request timeout in ms */
	readonly timeoutMs?: number;
	/** Maximum concurrent tasks */
	readonly maxConcurrency?: number;
}

export interface TaskRequest {
	/** Task to execute */
	task: RuntimeTask;
	/** Working directory for the task */
	workingDir: string;
	/** Context/memory from previous tasks */
	context?: string;
	/** Additional configuration */
	config?: {
		model?: string;
		temperature?: number;
		maxTokens?: number;
	};
}

export interface TaskResult {
	/** Task ID */
	taskId: string;
	/** Result status */
	status: TaskResultStatus;
	/** Summary of what was done */
	summary: string;
	/** Files that were changed */
	filesChanged?: string[];
	/** Output from the task */
	output?: string;
	/** Error message if failed */
	error?: string;
	/** Tokens used */
	usage?: {
		input: number;
		output: number;
		cost?: number;
	};
	/** Time taken in ms */
	durationMs: number;
	/** Timestamp */
	completedAt: string;
}

export interface HealthStatus {
	/** Whether the agent is healthy */
	healthy: boolean;
	/** Current status */
	status: AgentStatus;
	/** Current load (0-1) */
	load: number;
	/** Active task count */
	activeTasks: number;
	/** Queue depth */
	queueDepth: number;
	/** Last health check */
	checkedAt: string;
	/** Error message if unhealthy */
	error?: string;
}

// ─── Agent Worker Events ──────────────────────────────────────────────

export interface AgentWorkerEvents {
	/** Fired when task progress is made */
	onProgress: (taskId: string, progress: TaskProgress) => void;
	/** Fired when a task completes */
	onTaskComplete: (result: TaskResult) => void;
	/** Fired when an error occurs */
	onError: (taskId: string, error: Error) => void;
	/** Fired when agent status changes */
	onStatusChange: (status: AgentStatus) => void;
	/** Fired on health check changes */
	onHealthChange: (health: HealthStatus) => void;
}

export interface TaskProgress {
	taskId: string;
	phase: "planning" | "executing" | "reviewing" | "finalizing";
	message: string;
	percentComplete: number;
	timestamp: string;
}

// ─── Agent Worker Interface ───────────────────────────────────────────

export interface AgentWorker {
	/** Unique identifier */
	readonly id: string;
	/** Provider name */
	readonly provider: string;

	/**
	 * Initialize the agent worker
	 * @param config Worker configuration
	 */
	initialize(config: AgentWorkerConfig): Promise<void>;

	/**
	 * Execute a task
	 * @param request Task request
	 * @param events Event handlers
	 * @returns Task result
	 */
	execute(
		request: TaskRequest,
		events?: Partial<AgentWorkerEvents>,
	): Promise<TaskResult>;

	/**
	 * Check agent health
	 * @returns Health status
	 */
	health(): Promise<HealthStatus>;

	/**
	 * Get current status
	 * @returns Agent status
	 */
	status(): AgentStatus;

	/**
	 * Pause the agent (stop accepting new tasks)
	 */
	pause(): Promise<void>;

	/**
	 * Resume the agent
	 */
	resume(): Promise<void>;

	/**
	 * Stop the agent and cleanup
	 */
	stop(): Promise<void>;

	/**
	 * Check if a model is supported
	 * @param model Model identifier
	 * @returns Whether the model is supported
	 */
	supportsModel(model: string): boolean;

	/**
	 * Get supported models
	 * @returns List of supported model identifiers
	 */
	getSupportedModels(): string[];
}

// ─── DeepAgents Specific Types ───────────────────────────────────────

export interface DeepAgentsConfig extends AgentWorkerConfig {
	provider: "deepagents";
	/** DeepAgents server URL */
	endpoint: string;
	/** Project path to work in */
	projectPath?: string;
	/** Additional DeepAgents options */
	options?: {
		streaming?: boolean;
		autoRetry?: boolean;
		maxRetries?: number;
	};
}

export interface DeepAgentsTaskRequest extends TaskRequest {
	config?: TaskRequest["config"] & {
		/** Task priority */
		priority?: "low" | "normal" | "high";
		/** Whether to use sandbox */
		sandbox?: boolean;
		/** Environment variables */
		env?: Record<string, string>;
	};
}

export interface DeepAgentsResult extends TaskResult {
	/** DeepAgents-specific metadata */
	metadata?: {
		agentId?: string;
		workerId?: string;
		sandboxUrl?: string;
	};
}

// ─── Factory Function ─────────────────────────────────────────────────

export type AgentWorkerFactory = (config: AgentWorkerConfig) => AgentWorker;

/**
 * Registry of agent worker factories
 */
export class AgentWorkerRegistry {
	private factories: Map<string, AgentWorkerFactory> = new Map();

	/**
	 * Register a worker factory
	 */
	register(provider: string, factory: AgentWorkerFactory): void {
		this.factories.set(provider.toLowerCase(), factory);
	}

	/**
	 * Create a worker for a provider
	 */
	create(config: AgentWorkerConfig): AgentWorker | undefined {
		const factory = this.factories.get(config.provider.toLowerCase());
		if (!factory) {
			return undefined;
		}
		return factory(config);
	}

	/**
	 * Check if a provider is supported
	 */
	supports(provider: string): boolean {
		return this.factories.has(provider.toLowerCase());
	}

	/**
	 * List all supported providers
	 */
	listProviders(): string[] {
		return Array.from(this.factories.keys());
	}
}

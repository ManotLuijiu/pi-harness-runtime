/**
 * Performance Optimizer Types (RFC-0056)
 *
 * Interfaces for performance analysis and recommendations.
 */

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface RuntimeMetricSnapshot {
	jobId: string;
	timestamp: string;
	/** Total tokens used */
	totalTokens: number;
	/** Tokens used in last request */
	lastRequestTokens: number;
	/** Average latency in milliseconds */
	avgLatencyMs: number;
	/** Number of retries */
	retryCount: number;
	/** Number of successful calls */
	successCount: number;
	/** Number of failed calls */
	failureCount: number;
	/** Current context size in tokens */
	currentContextTokens: number;
	/** Max context window */
	contextWindow: number;
	/** Provider-specific metrics */
	providerMetrics: Record<string, ProviderMetric>;
}

export interface ProviderMetric {
	providerId: string;
	callCount: number;
	successCount: number;
	failureCount: number;
	avgLatencyMs: number;
	avgTokensPerCall: number;
}

export interface ProviderRuntimeState {
	providerId: string;
	state: "available" | "limited" | "exhausted" | "disabled" | "unknown";
	remainingQuota?: number;
	avgLatencyMs?: number;
	lastError?: string;
}

export interface PerformancePolicy {
	/** Minimum context usage to consider reduction */
	minContextReductionPercent: number;
	/** Maximum parallelism allowed */
	maxParallelism: number;
	/** Minimum improvement threshold for recommendations */
	minImprovementPercent: number;
	/** Whether to allow provider switching */
	allowProviderSwitch: boolean;
	/** Mandatory stages that cannot be skipped */
	mandatoryStages: string[];
}

// ─── Local Type Definitions ────────────────────────────────────────────────────

export interface TaskGraphSnapshot {
	nodes: Array<{
		id: string;
		status: string;
	}>;
	edges: Array<{ from: string; to: string }>;
}

export interface PerformanceOptimizationRequest {
	jobId: string;
	taskId?: string;
	metrics: RuntimeMetricSnapshot;
	providerStates: ProviderRuntimeState[];
	taskGraph: TaskGraphSnapshot;
	policy: PerformancePolicy;
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export type PerformanceRecommendation =
	| { type: "reduce_context"; targetTokens: number; reason: string }
	| { type: "change_provider"; provider: string; reason: string }
	| { type: "increase_parallelism"; limit: number; reason: string }
	| { type: "decrease_parallelism"; limit: number; reason: string }
	| { type: "reuse_checkpoint"; checkpointId: string; reason: string }
	| { type: "skip_redundant_step"; taskId: string; reason: string };

export interface PerformanceOptimizationPlan {
	jobId: string;
	recommendations: PerformanceRecommendation[];
	expectedImpact: {
		tokenReductionPercent?: number;
		latencyReductionPercent?: number;
		retryReductionPercent?: number;
	};
	generatedAt: string;
}

// ─── Runtime Events ────────────────────────────────────────────────────────────

export type PerformanceOptimizerEvent =
	| { type: "performance.analysis.started"; jobId: string }
	| {
			type: "performance.recommendation.created";
			jobId: string;
			recommendation: PerformanceRecommendation;
	  }
	| { type: "performance.analysis.completed"; jobId: string }
	| { type: "performance.analysis.failed"; jobId: string; error: string };

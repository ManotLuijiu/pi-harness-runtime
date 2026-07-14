/**
 * Evaluation Runner — Types (RFC-0020)
 */

export interface EvaluationInput {
	prompt: string;
	expectedOutput?: string;
	metadata?: Record<string, unknown>;
}

export interface EvaluationResult {
	runId: string;
	metric: string;
	score: number;
	passed: boolean;
	details?: string;
	latencyMs?: number;
}

export interface EvaluationSuite {
	id: string;
	name: string;
	cases: EvaluationCase[];
	thresholds: Record<string, number>;
}

export interface EvaluationCase {
	id: string;
	name: string;
	input: EvaluationInput;
	expected?: string;
	evaluators: string[];
}

export type EvaluatorFn = (input: EvaluationInput, output: string) => Promise<EvaluationResult>

export interface EvaluationReport {
	suiteId: string;
	runAt: string;
	total: number;
	passed: number;
	failed: number;
	results: EvaluationResult[];
	summary: Record<string, { count: number; avgScore: number }>;
}

export interface EvaluationConfig {
	timeoutMs?: number;
	retries?: number;
	parallel?: boolean;
}

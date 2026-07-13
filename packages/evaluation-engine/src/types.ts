/**
 * Evaluation Engine Types (RFC-0057)
 *
 * Interfaces for task evaluation and acceptance criteria checking.
 */

// ─── Task Output Types ─────────────────────────────────────────────────────────

export interface TaskOutputArtifact {
	id: string;
	type: "file" | "directory" | "url" | "test-result" | "screenshot" | "log";
	path?: string;
	url?: string;
	description: string;
	hash?: string;
	timestamp?: string;
}

export interface TestResult {
	id: string;
	testFile: string;
	status: "passed" | "failed" | "skipped" | "error";
	durationMs?: number;
	errorMessage?: string;
	testCount?: number;
	passedCount?: number;
	failedCount?: number;
}

export interface PolicyFinding {
	ruleId: string;
	severity: "critical" | "high" | "medium" | "low";
	message: string;
	filePath?: string;
	line?: number;
}

export interface CompiledTask {
	id: string;
	title: string;
	description: string;
	acceptanceCriteria: string[];
	requiredArtifacts: string[];
	mandatoryStages: string[];
}

// ─── Evaluation Types ─────────────────────────────────────────────────────────

export interface EvaluationRequest {
	jobId: string;
	task: CompiledTask;
	worktreePath: string;
	outputs: TaskOutputArtifact[];
	testResults: TestResult[];
	policyFindings: PolicyFinding[];
}

export type EvaluationStatus = "passed" | "failed" | "needs_review";

export interface EvaluationFinding {
	dimension: EvaluationDimension;
	severity: "critical" | "high" | "medium" | "low";
	message: string;
	evidence?: string;
	criterion?: string;
}

export type EvaluationDimension =
	| "correctness"
	| "test_completeness"
	| "acceptance_coverage"
	| "policy_compliance"
	| "code_quality"
	| "security_risk"
	| "regression_risk"
	| "documentation";

export interface EvaluationEvidence {
	kind: "test" | "diff" | "file" | "policy" | "screenshot" | "trace";
	path?: string;
	description: string;
	hash?: string;
}

export type EvaluationResultStatus = "passed" | "failed" | "needs_review";

export interface EvaluationResult {
	status: EvaluationResultStatus;
	score: number;
	findings: EvaluationFinding[];
	evidence: EvaluationEvidence[];
	recommendedAction: "continue" | "repair" | "human_review";
	evaluationId: string;
	jobId: string;
	taskId: string;
	evaluatedAt: string;
}

export type EvaluationFailureClass =
	| "test_failure"
	| "missing_output"
	| "acceptance_gap"
	| "policy_violation"
	| "security_issue"
	| "regression_risk"
	| "insufficient_evidence";

export type EvaluationState =
	| "pending"
	| "collecting_evidence"
	| "evaluating"
	| "passed"
	| "failed"
	| "needs_review";

// ─── Scoring Weights ───────────────────────────────────────────────────────────

export interface ScoringWeights {
	correctness: number;
	test: number;
	acceptance: number;
	quality: number;
	policyPenalty: number;
	securityPenalty: number;
	regressionPenalty: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
	correctness: 30,
	test: 20,
	acceptance: 20,
	quality: 15,
	policyPenalty: 20,
	securityPenalty: 30,
	regressionPenalty: 15,
};

/**
 * Evaluation Engine (RFC-0057)
 *
 * Determines whether an agent-produced result is acceptable before advancing.
 */

import { randomUUID } from "node:crypto";
import type {
	EvaluationRequest,
	EvaluationResult,
	EvaluationFinding,
	EvaluationEvidence,
	EvaluationStatus,
	EvaluationFailureClass,
	EvaluationState,
	TaskOutputArtifact,
	TestResult,
	PolicyFinding,
	ScoringWeights,
} from "./types.js";
import { DEFAULT_SCORING_WEIGHTS } from "./types.js";

// ─── Evidence Collection ───────────────────────────────────────────────────────

function collectEvidence(
	outputs: TaskOutputArtifact[],
	testResults: TestResult[],
	policyFindings: PolicyFinding[],
): EvaluationEvidence[] {
	const evidence: EvaluationEvidence[] = [];

	// Add test results as evidence
	for (const test of testResults) {
		evidence.push({
			kind: "test",
			path: test.testFile,
			description: `Test ${test.id}: ${test.status}`,
			hash: test.id,
		});
	}

	// Add output files as evidence
	for (const output of outputs) {
		if (output.path) {
			evidence.push({
				kind: "file",
				path: output.path,
				description: output.description,
				hash: output.hash,
			});
		}
	}

	// Add policy findings as evidence
	for (const finding of policyFindings) {
		evidence.push({
			kind: "policy",
			path: finding.filePath,
			description: `[${finding.severity.toUpperCase()}] ${finding.ruleId}: ${finding.message}`,
		});
	}

	return evidence;
}

// ─── Missing Output Detection ──────────────────────────────────────────────────

function findMissingOutputs(
	requiredArtifacts: string[],
	outputs: TaskOutputArtifact[],
): EvaluationFinding[] {
	const findings: EvaluationFinding[] = [];
	const outputPaths = new Set(outputs.filter((o) => o.path).map((o) => o.path));

	for (const required of requiredArtifacts) {
		const requiredLower = required.toLowerCase();
		const found =
			outputPaths.has(required) ||
			outputs.some((o) => o.description.toLowerCase().includes(requiredLower));

		if (!found) {
			findings.push({
				dimension: "correctness",
				severity: "critical",
				message: `Required artifact '${required}' is missing from outputs`,
				evidence: `Required: ${required}, Available: ${[...outputPaths].join(", ") || "none"}`,
			});
		}
	}

	return findings;
}

// ─── Test Analysis ────────────────────────────────────────────────────────────

function analyzeTests(testResults: TestResult[]): {
	findings: EvaluationFinding[];
	passedCount: number;
	totalCount: number;
	hasFailures: boolean;
} {
	const findings: EvaluationFinding[] = [];
	let passedCount = 0;
	let totalCount = 0;
	let hasFailures = false;

	for (const test of testResults) {
		totalCount++;
		if (test.status === "passed") {
			passedCount++;
		} else if (test.status === "failed" || test.status === "error") {
			hasFailures = true;
			findings.push({
				dimension: "test_completeness",
				severity: "critical",
				message: `Test '${test.testFile}' ${test.status}: ${test.errorMessage || "Unknown error"}`,
				evidence: test.errorMessage,
			});
		}
	}

	if (testResults.length === 0) {
		findings.push({
			dimension: "test_completeness",
			severity: "high",
			message: "No test results provided",
		});
	}

	return { findings, passedCount, totalCount, hasFailures };
}

// ─── Policy Analysis ──────────────────────────────────────────────────────────

function analyzePolicies(policyFindings: PolicyFinding[]): {
	findings: EvaluationFinding[];
	criticalFindings: PolicyFinding[];
} {
	const findings: EvaluationFinding[] = [];
	const criticalFindings: PolicyFinding[] = [];

	for (const finding of policyFindings) {
		findings.push({
			dimension: "policy_compliance",
			severity: finding.severity,
			message: `${finding.ruleId}: ${finding.message}`,
			evidence: finding.filePath
				? `${finding.filePath}:${finding.line || "?"}`
				: undefined,
		});

		if (finding.severity === "critical") {
			criticalFindings.push(finding);
		}
	}

	return { findings, criticalFindings };
}

// ─── Acceptance Criteria Coverage ─────────────────────────────────────────────

function analyzeAcceptanceCoverage(
	acceptanceCriteria: string[],
	outputs: TaskOutputArtifact[],
	testResults: TestResult[],
): {
	findings: EvaluationFinding[];
	coverage: number;
	unmetCriteria: string[];
} {
	const findings: EvaluationFinding[] = [];
	const coveredCriteria: string[] = [];
	const unmetCriteria: string[] = [];
	const outputText = outputs
		.map((o) => `${o.description} ${o.path || ""}`.toLowerCase())
		.join(" ");
	const passingTests = testResults.filter((t) => t.status === "passed");
	const passingTestText = passingTests
		.map((t) => `${t.testFile} ${t.errorMessage || ""}`.toLowerCase())
		.join(" ");

	for (const criterion of acceptanceCriteria) {
		const criterionLower = criterion.toLowerCase();
		const keywords = criterionLower
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length >= 4);
		const outputKeywordMatches = keywords.filter((word) =>
			outputText.includes(word),
		).length;
		const coveredByOutput =
			keywords.length > 0 &&
			outputKeywordMatches >= Math.ceil(keywords.length / 2);
		const coveredByPassingTests =
			passingTests.length > 0 &&
			(criterionLower.includes("test") ||
				criterionLower.includes("pass") ||
				keywords.some((word) => passingTestText.includes(word)));

		if (coveredByOutput || coveredByPassingTests) {
			coveredCriteria.push(criterion);
		} else {
			unmetCriteria.push(criterion);
			findings.push({
				dimension: "acceptance_coverage",
				severity: "medium",
				message: `Acceptance criterion not covered: '${criterion}'`,
				criterion,
			});
		}
	}

	const coverage =
		acceptanceCriteria.length > 0
			? (coveredCriteria.length / acceptanceCriteria.length) * 100
			: 100;

	return { findings, coverage, unmetCriteria };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function calculateScore(
	weights: ScoringWeights,
	testAnalysis: {
		passedCount: number;
		totalCount: number;
		hasFailures: boolean;
	},
	acceptanceCoverage: number,
	criticalPolicies: PolicyFinding[],
	securityFindings: EvaluationFinding[],
	regressionFindings: EvaluationFinding[],
): { score: number; breakdown: Record<string, number> } {
	const breakdown: Record<string, number> = {};

	// Correctness (30%) - based on missing outputs
	const correctnessScore = weights.correctness;
	breakdown.correctness = correctnessScore;

	// Test completeness (20%)
	let testScore = 0;
	if (testAnalysis.totalCount > 0) {
		testScore =
			(testAnalysis.passedCount / testAnalysis.totalCount) * weights.test;
	}
	breakdown.tests = testScore;

	// Acceptance coverage (20%)
	const acceptanceScore = (acceptanceCoverage / 100) * weights.acceptance;
	breakdown.acceptance = acceptanceScore;

	// Code quality (15%) - assume passed if no major findings
	const qualityScore = weights.quality;
	breakdown.quality = qualityScore;

	// Policy penalty (deducted)
	let policyPenalty = 0;
	for (const _ of criticalPolicies) {
		policyPenalty += weights.policyPenalty;
	}
	breakdown.policyPenalty = -policyPenalty;

	// Security penalty (deducted)
	const securityPenalty = securityFindings.length * weights.securityPenalty;
	breakdown.securityPenalty = -securityPenalty;

	// Regression penalty (deducted)
	const regressionPenalty =
		regressionFindings.length * weights.regressionPenalty;
	breakdown.regressionPenalty = -regressionPenalty;

	const totalScore = Math.max(
		0,
		Math.min(
			100,
			correctnessScore +
				testScore +
				acceptanceScore +
				qualityScore -
				policyPenalty -
				securityPenalty -
				regressionPenalty,
		),
	);

	return { score: Math.round(totalScore), breakdown };
}

// ─── Failure Classification ───────────────────────────────────────────────────

function classifyFailure(
	findings: EvaluationFinding[],
): EvaluationFailureClass[] {
	const classes: EvaluationFailureClass[] = [];

	for (const finding of findings) {
		if (
			finding.dimension === "test_completeness" &&
			finding.severity === "critical"
		) {
			if (!classes.includes("test_failure")) classes.push("test_failure");
		}
		if (finding.dimension === "correctness" && finding.severity === "high") {
			if (!classes.includes("missing_output")) classes.push("missing_output");
		}
		if (
			finding.dimension === "acceptance_coverage" &&
			finding.severity === "medium"
		) {
			if (!classes.includes("acceptance_gap")) classes.push("acceptance_gap");
		}
		if (finding.dimension === "policy_compliance") {
			if (finding.severity === "critical") {
				if (!classes.includes("policy_violation"))
					classes.push("policy_violation");
			}
		}
		if (finding.dimension === "security_risk") {
			if (!classes.includes("security_issue")) classes.push("security_issue");
		}
		if (finding.dimension === "regression_risk") {
			if (!classes.includes("regression_risk")) classes.push("regression_risk");
		}
	}

	if (classes.length === 0 && findings.length > 0) {
		classes.push("insufficient_evidence");
	}

	return classes;
}

// ─── Main Engine ───────────────────────────────────────────────────────────────

export class EvaluationEngine {
	private weights: ScoringWeights;
	private state: EvaluationState = "pending";

	constructor(weights?: Partial<ScoringWeights>) {
		this.weights = { ...DEFAULT_SCORING_WEIGHTS, ...weights };
	}

	/**
	 * Evaluate a task against its acceptance criteria
	 */
	evaluate(request: EvaluationRequest): EvaluationResult {
		this.state = "collecting_evidence";

		const { jobId, task, outputs, testResults, policyFindings } = request;
		const allFindings: EvaluationFinding[] = [];

		this.state = "evaluating";

		// 1. Check for missing required outputs
		const missingOutputs = findMissingOutputs(task.requiredArtifacts, outputs);
		allFindings.push(...missingOutputs);

		// 2. Analyze tests
		const testAnalysis = analyzeTests(testResults);
		allFindings.push(...testAnalysis.findings);

		// 3. Analyze policies
		const policyAnalysis = analyzePolicies(policyFindings);
		allFindings.push(...policyAnalysis.findings);

		// 4. Check acceptance criteria coverage
		const acceptanceAnalysis = analyzeAcceptanceCoverage(
			task.acceptanceCriteria,
			outputs,
			testResults,
		);
		allFindings.push(...acceptanceAnalysis.findings);

		// 5. Check for security issues
		const securityFindings = allFindings.filter(
			(f) => f.dimension === "security_risk",
		);

		// 6. Check for regression risks
		const regressionFindings = allFindings.filter(
			(f) => f.dimension === "regression_risk",
		);

		// 7. Calculate score
		const { score, breakdown: _breakdown } = calculateScore(
			this.weights,
			testAnalysis,
			acceptanceAnalysis.coverage,
			policyAnalysis.criticalFindings,
			securityFindings,
			regressionFindings,
		);

		// 8. Collect evidence
		const evidence = collectEvidence(outputs, testResults, policyFindings);

		// 9. Determine status and recommended action
		let status: EvaluationStatus;
		let recommendedAction: EvaluationResult["recommendedAction"];

		// Critical policy violations force failure
		if (policyAnalysis.criticalFindings.length > 0) {
			status = "failed";
			recommendedAction = "repair";
			this.state = "failed";
		}
		// Test failures force failure
		else if (testAnalysis.hasFailures) {
			status = "failed";
			recommendedAction = "repair";
			this.state = "failed";
		}
		// Missing critical outputs
		else if (missingOutputs.some((f) => f.severity === "critical")) {
			status = "failed";
			recommendedAction = "repair";
			this.state = "failed";
		}
		// Low score with significant gaps
		else if (score < 50) {
			status = "failed";
			recommendedAction = "repair";
			this.state = "failed";
		}
		// Ambiguous criteria coverage
		else if (
			acceptanceAnalysis.coverage < 80 &&
			acceptanceAnalysis.unmetCriteria.length > 0
		) {
			status = "needs_review";
			recommendedAction = "human_review";
			this.state = "needs_review";
		}
		// Good score
		else {
			status = "passed";
			recommendedAction = "continue";
			this.state = "passed";
		}

		// 10. Classify failure
		const failureClasses = classifyFailure(allFindings);

		// Add failure classification as a finding if failed
		if (status === "failed" && failureClasses.length > 0) {
			allFindings.push({
				dimension: "correctness",
				severity: "critical",
				message: `Evaluation failed due to: ${failureClasses.join(", ")}`,
				evidence: failureClasses.join(", "),
			});
		}

		return {
			status,
			score,
			findings: allFindings,
			evidence,
			recommendedAction,
			evaluationId: randomUUID(),
			jobId,
			taskId: task.id,
			evaluatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Get current evaluation state
	 */
	getState(): EvaluationState {
		return this.state;
	}

	/**
	 * Reset engine state
	 */
	reset(): void {
		this.state = "pending";
	}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createEvaluationEngine(
	weights?: Partial<ScoringWeights>,
): EvaluationEngine {
	return new EvaluationEngine(weights);
}

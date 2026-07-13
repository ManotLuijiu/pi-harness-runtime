/**
 * Learning Engine Types (RFC-0058)
 *
 * Interfaces for learning from runtime execution.
 */

// ─── Runtime Event (local definition) ─────────────────────────────────────────

export interface RuntimeEvent {
	ts: string;
	jobId: string;
	type: string;
	message: string;
	data?: Record<string, unknown>;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface ProviderExecutionMetric {
	providerId: string;
	taskType: string;
	successCount: number;
	failureCount: number;
	avgLatencyMs: number;
	avgTokensUsed: number;
}

export interface RepairAttempt {
	taskId: string;
	repairType: string;
	success: boolean;
	error?: string;
	attempts: number;
}

export interface HumanFeedback {
	jobId: string;
	taskId: string;
	feedback: "positive" | "negative" | "neutral";
	comment?: string;
	approved?: boolean;
	timestamp: string;
}

export interface LearningRequest {
	jobId: string;
	events: RuntimeEvent[];
	evaluation?: {
		taskId: string;
		score: number;
		passed: boolean;
	}[];
	repairHistory: RepairAttempt[];
	providerMetrics: ProviderExecutionMetric[];
	humanFeedback?: HumanFeedback[];
}

// ─── Learned Experience ───────────────────────────────────────────────────────

export type ExperienceScope =
	| "global"
	| "framework"
	| "repository"
	| "task_type";
export type ExperienceStatus = "proposed" | "approved" | "rejected";

export interface LearnedExperience {
	id: string;
	scope: ExperienceScope;
	pattern: string;
	recommendation: string;
	confidence: number;
	evidenceRefs: string[];
	status: ExperienceStatus;
	createdAt: string;
	updatedAt: string;
	tags: string[];
	taskType?: string;
	framework?: string;
	repository?: string;
}

export interface LearningResult {
	jobId: string;
	experiences: LearnedExperience[];
	summary: {
		totalExtracted: number;
		approved: number;
		proposed: number;
		rejected: number;
	};
	extractedAt: string;
}

// ─── Patterns ───────────────────────────────────────────────────────────────

export type PatternType =
	| "provider_success"
	| "prompt_structure"
	| "failure_cause"
	| "repair_strategy"
	| "framework_command"
	| "test_scenario"
	| "context_source";

export interface ExtractedPattern {
	type: PatternType;
	description: string;
	occurrenceCount: number;
	successIndicators: string[];
	failureIndicators: string[];
}

// ─── Secret Detection ─────────────────────────────────────────────────────────

export const SECRET_PATTERNS = [
	/api[_-]?key/i,
	/password/i,
	/secret/i,
	/token/i,
	/bearer/i,
	/auth/i,
	/credential/i,
	/private[_-]?key/i,
	/access[_-]?token/i,
	/refresh[_-]?token/i,
];

export function containsSecret(value: string): boolean {
	return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function redactSecrets(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const redacted = { ...data };

	for (const [key, value] of Object.entries(redacted)) {
		if (typeof value === "string" && containsSecret(key)) {
			(redacted as any)[key] = "[REDACTED]";
		} else if (typeof value === "object" && value !== null) {
			(redacted as any)[key] = redactSecrets(value as Record<string, unknown>);
		}
	}

	return redacted;
}

// ─── Confidence Calculation ────────────────────────────────────────────────────

export interface ConfidenceFactors {
	occurrenceCount: number;
	consistentPositiveOutcomes: number;
	humanApprovalCount: number;
	frameworkCorroboration: number;
	contradictoryOutcomes: number;
	singleEventEvidence: boolean;
	staleRepository: boolean;
	changedProjectRules: boolean;
}

export function calculateConfidence(factors: ConfidenceFactors): number {
	let confidence = 0;

	// Occurrence boost (up to +30)
	confidence += Math.min(30, factors.occurrenceCount * 5);

	// Consistent positive outcomes (up to +25)
	if (factors.occurrenceCount > 0) {
		const consistencyRatio =
			factors.consistentPositiveOutcomes / factors.occurrenceCount;
		confidence += consistencyRatio * 25;
	}

	// Human approval (up to +20)
	confidence += Math.min(20, factors.humanApprovalCount * 10);

	// Framework corroboration (up to +10)
	confidence += Math.min(10, factors.frameworkCorroboration * 5);

	// Penalties
	// Contradictory outcomes (-15 per)
	confidence -= Math.min(40, factors.contradictoryOutcomes * 15);

	// Single event evidence (-10)
	if (factors.singleEventEvidence) {
		confidence -= 10;
	}

	// Stale repository (-5)
	if (factors.staleRepository) {
		confidence -= 5;
	}

	// Changed project rules (-20)
	if (factors.changedProjectRules) {
		confidence -= 20;
	}

	return Math.max(0, Math.min(100, Math.round(confidence)));
}

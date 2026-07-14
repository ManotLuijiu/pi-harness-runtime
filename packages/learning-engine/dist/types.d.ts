/**
 * Learning Engine Types (RFC-0058)
 *
 * Interfaces for learning from runtime execution.
 */
export interface RuntimeEvent {
    ts: string;
    jobId: string;
    type: string;
    message: string;
    data?: Record<string, unknown>;
}
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
export type ExperienceScope = "global" | "framework" | "repository" | "task_type";
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
export type PatternType = "provider_success" | "prompt_structure" | "failure_cause" | "repair_strategy" | "framework_command" | "test_scenario" | "context_source";
export interface ExtractedPattern {
    type: PatternType;
    description: string;
    occurrenceCount: number;
    successIndicators: string[];
    failureIndicators: string[];
}
export declare const SECRET_PATTERNS: RegExp[];
export declare function containsSecret(value: string): boolean;
export declare function redactSecrets(data: Record<string, unknown>): Record<string, unknown>;
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
export declare function calculateConfidence(factors: ConfidenceFactors): number;
//# sourceMappingURL=types.d.ts.map
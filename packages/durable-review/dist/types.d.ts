/**
 * Durable Review Types
 *
 * Public request/status/result types and validators.
 */
import { Type, type Static } from "typebox";
/**
 * Review job status
 */
export type ReviewStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
/**
 * Review verdict
 */
export type Verdict = "approved" | "changes_requested" | "blocked";
/**
 * Finding from the reviewer
 */
export interface Finding {
    rule: string;
    severity: "error" | "warning" | "info";
    message: string;
    file?: string;
    line?: number;
    endLine?: number;
}
/**
 * Review input content
 */
export interface ReviewInput {
    workspacePath: string;
    diff?: string;
    stagedChanges?: string;
    unstagedChanges?: string;
    selectedFiles?: string[];
    baseCommit?: string;
    prompt?: string;
}
/**
 * Review request
 */
export interface ReviewRequest {
    requestId: string;
    input: ReviewInput;
    provider?: string;
    model?: string;
    maxPasses?: number;
    maxToolCalls?: number;
}
/**
 * Review job status record
 */
export interface ReviewJob {
    jobId: string;
    requestId: string;
    workspacePath: string;
    canonicalWorkspace: string;
    workspaceKey: string;
    inputHash: string;
    inputSnapshotId?: string;
    provider?: string;
    model?: string;
    maxPasses: number;
    maxToolCalls: number;
    conversationId?: string;
    submissionId?: string;
    status: ReviewStatus;
    verdict?: Verdict;
    findings?: Finding[];
    summary?: string;
    error?: string;
    reportId?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}
/**
 * Review result (completed job)
 */
export interface ReviewResult {
    jobId: string;
    requestId: string;
    verdict: Verdict;
    findings: Finding[];
    summary: string;
    reportId: string;
    completedAt: string;
}
/**
 * Review status response
 */
export interface ReviewStatusResponse {
    jobId: string;
    status: ReviewStatus;
    verdict?: Verdict;
    findings?: Finding[];
    summary?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}
/**
 * Worker ready response
 */
export interface WorkerReadyResponse {
    ready: boolean;
    workspaceKey?: string;
    pendingJobs?: number;
    error?: string;
}
/**
 * TypeBox schemas for validation
 */
export declare const ReviewRequestSchema: Type.TObject<{
    requestId: Type.TString;
    input: Type.TObject<{
        workspacePath: Type.TString;
        diff: Type.TOptional<Type.TString>;
        stagedChanges: Type.TOptional<Type.TString>;
        unstagedChanges: Type.TOptional<Type.TString>;
        selectedFiles: Type.TOptional<Type.TArray<Type.TString>>;
        baseCommit: Type.TOptional<Type.TString>;
        prompt: Type.TOptional<Type.TString>;
    }>;
    provider: Type.TOptional<Type.TString>;
    model: Type.TOptional<Type.TString>;
    maxPasses: Type.TOptional<Type.TNumber>;
    maxToolCalls: Type.TOptional<Type.TNumber>;
}>;
export type ReviewRequestInput = Static<typeof ReviewRequestSchema>;
/**
 * Validate a review request
 */
export declare function validateReviewRequest(input: unknown): {
    valid: boolean;
    error?: string;
    request?: ReviewRequest;
};
//# sourceMappingURL=types.d.ts.map
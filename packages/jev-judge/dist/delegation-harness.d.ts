/**
 * Delegation Harness Integration
 *
 * Connects delegation assessment to the harness runtime.
 * Uses inline types to avoid cross-package dependency.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Extension capability for delegation (inline to avoid dependency)
 */
export interface ExtensionCapability {
    name: string;
    supportsSubagents: boolean;
    supportsWorkIsolation: boolean;
    supportsCancellation: boolean;
    availableTools: string[];
    verified: boolean;
}
/**
 * Delegation strategy decision
 */
export type DelegationStrategy = "delegate" | "script_then_delegate" | "script_only" | "single_agent" | "unavailable";
/**
 * Delegation decision
 */
export interface DelegationDecision {
    strategy: DelegationStrategy;
    reason: string;
    workGroups: unknown[];
    validationExpectations: string;
    confidence: "high" | "medium" | "low";
    jevUsed: boolean;
    reassessmentTriggers: string[];
}
/**
 * Scope facts
 */
export interface ScopeFacts {
    estimatedFiles: number;
    observedFiles: number;
    estimatedCallSites: number;
    observedCallSites: number;
    independentComponents: number;
    tightlyCoupled: boolean;
    isMechanical: boolean;
    isComplex: boolean;
    fileTypes: Record<string, number>;
    fingerprint: string;
}
/**
 * Delegation receipt
 */
export interface DelegationReceipt {
    version: number;
    workspacePath: string;
    sessionId: string;
    parentTaskId: string;
    scopeFingerprint: string;
    decision: DelegationDecision;
    createdAt: number;
    updatedAt: number;
    status: "assessing" | "in_progress" | "completed" | "failed" | "cancelled";
    childIds: string[];
    pendingValidation: string[];
    userConstraints: string[];
}
/**
 * Delegation harness configuration
 */
export interface DelegationHarnessConfig {
    minFiles?: number;
    minCallSites?: number;
    minComponents?: number;
}
/**
 * Create delegation harness integration
 */
export declare function createDelegationHarness(pi: ExtensionAPI, config?: DelegationHarnessConfig): {
    discoverCapability: () => Promise<ExtensionCapability | null>;
    shouldAssess: (facts: ScopeFacts) => boolean;
    assess: (facts: ScopeFacts, parentTaskId: string) => Promise<DelegationDecision | null>;
    getReceipt: () => DelegationReceipt | null;
    getLastDecision: () => DelegationDecision | null;
    clear: () => void;
};
export type DelegationHarness = ReturnType<typeof createDelegationHarness>;
//# sourceMappingURL=delegation-harness.d.ts.map
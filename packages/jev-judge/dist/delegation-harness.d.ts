/**
 * Delegation Harness Integration
 *
 * Connects delegation assessment to the harness runtime.
 * Uses inline types to avoid cross-package dependency.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ScopeMeasurement, ScopeWorkGroup } from "./delegation-scope.js";
import { type DelegationChild } from "./delegation-observer.js";
/**
 * Extension capability for delegation (inline to avoid dependency)
 */
export interface ExtensionCapability {
    name: string;
    /** The tool that can dispatch a child. */
    toolName: string;
    supportsSubagents: boolean;
    /**
     * The schema of the tool carries a parameter that isolates the work of
     * a child. Without such a parameter the claim is not made.
     */
    supportsWorkIsolation: boolean;
    /**
     * The schema of the tool carries a parameter that stops a child. Without
     * such a parameter the claim is not made.
     */
    supportsCancellation: boolean;
    availableTools: string[];
    /**
     * The schema of the tool was read and the tool is active.
     *
     * This is not a proof that a child ever ran: it says that the session
     * can ask for one. Only a dispatch that was really sent proves that.
     */
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
    /**
     * The groups the work falls into. They are empty unless the scope was
     * measured: a decision without groups is not a delegation plan.
     */
    workGroups: ScopeWorkGroup[];
    validationExpectations: string;
    confidence: "high" | "medium" | "low";
    jevUsed: boolean;
    /**
     * Whether a child was really dispatched.
     *
     * The harness assesses the work, it does not run it: the agent is the
     * one that sends the groups to the sub-agent tool.
     */
    dispatched: boolean;
    /**
     * The name of the active tool that can dispatch a child.
     *
     * It is empty when no such tool is active. The name is the proof that
     * the dispatch is possible, not the proof that it happened.
     */
    dispatchTool?: string;
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
    /**
     * The measured groups of the work. A delegation decision needs them:
     * without groups there is nothing to hand to a child.
     */
    workGroups: ScopeWorkGroup[];
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
    /**
     * The children that were really dispatched.
     *
     * They are observed, not assumed: a child is in this list when its
     * tool call was seen, and it carries what the extension reported.
     */
    children: DelegationChild[];
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
 * Build the scope facts from a measurement.
 *
 * Every number is a count of something the measurement found. The
 * estimate is the size of the workspace: it is a real number, and it says
 * how much of the repository the measured files are.
 */
export declare function scopeFactsFromMeasurement(measurement: ScopeMeasurement): ScopeFacts;
/**
 * Build the message that hands a delegation plan to the agent.
 *
 * The message names the measured groups and the tool that can dispatch a
 * child. It does not claim that anything was dispatched: the harness
 * measured the work, the agent is the one that sends the groups out.
 *
 * @param decision The decision of the assessment.
 * @returns The message, or null when there is nothing to hand out.
 */
export declare function buildDelegationSteer(decision: {
    strategy: string;
    workGroups?: {
        id: string;
        files: string[];
    }[];
    dispatchTool?: string;
} | null): string | null;
/**
 * The property names of a tool schema.
 *
 * A schema is a plain object: the properties of the object, of every
 * branch of a union, and of every item of an array.
 */
export declare function schemaPropertyNames(schema: unknown): Set<string>;
/**
 * Create delegation harness integration
 */
export declare function createDelegationHarness(pi: ExtensionAPI, config?: DelegationHarnessConfig): {
    discoverCapability: () => Promise<ExtensionCapability | null>;
    shouldAssess: (facts: ScopeFacts) => boolean;
    assess: (facts: ScopeFacts, parentTaskId: string) => Promise<DelegationDecision | null>;
    observeToolStart: (event: {
        toolCallId: string;
        toolName: string;
        args?: unknown;
    }) => DelegationChild | null;
    observeToolEnd: (event: {
        toolCallId: string;
        toolName: string;
        result?: unknown;
        isError?: boolean;
    }) => DelegationChild | null;
    getChildren: () => DelegationChild[];
    getReceipt: () => DelegationReceipt | null;
    getLastDecision: () => DelegationDecision | null;
    clear: () => void;
};
export type DelegationHarness = ReturnType<typeof createDelegationHarness>;
//# sourceMappingURL=delegation-harness.d.ts.map
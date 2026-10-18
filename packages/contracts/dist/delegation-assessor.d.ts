/**
 * Delegation Assessor
 *
 * Assesses whether work should be delegated to sub-agents based on scope.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ScopeFacts, DelegationDecision, DelegationTriggerConfig, ExtensionCapability } from "./delegation.js";
/**
 * Discover extension capabilities for delegation
 */
export declare function discoverDelegationCapability(pi: ExtensionAPI): Promise<ExtensionCapability | null>;
/**
 * Estimate scope from file analysis
 */
export declare function estimateScope(_pi: ExtensionAPI, patterns: string[]): Promise<ScopeFacts>;
/**
 * Make deterministic assessment without Jev
 */
export declare function makeDeterministicAssessment(facts: ScopeFacts, capability: ExtensionCapability | null): DelegationDecision;
/**
 * Assess delegation need
 */
export declare function assessDelegation(pi: ExtensionAPI, facts: ScopeFacts, config?: DelegationTriggerConfig): Promise<DelegationDecision | null>;
/**
 * Validate assessment is still valid
 */
export declare function isAssessmentStale(decision: DelegationDecision, currentFacts: ScopeFacts, originalFacts: ScopeFacts): boolean;

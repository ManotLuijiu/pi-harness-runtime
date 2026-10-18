/**
 * Delegation Harness Integration
 *
 * Connects delegation assessment to the harness runtime.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionCapability } from "@pi-harness/contracts";
import { type DelegationDecision } from "@pi-harness/contracts";
import type { DelegationReceipt, ScopeFacts } from "@pi-harness/contracts";
/**
 * Delegation harness configuration
 */
export interface DelegationHarnessConfig {
    /** Minimum files to trigger assessment */
    minFiles?: number;
    /** Minimum call sites to trigger assessment */
    minCallSites?: number;
    /** Minimum independent components for delegation */
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
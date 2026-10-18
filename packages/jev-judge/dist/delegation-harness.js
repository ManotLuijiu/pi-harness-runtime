/**
 * Delegation Harness Integration
 *
 * Connects delegation assessment to the harness runtime.
 */
import { discoverDelegationCapability, makeDeterministicAssessment, } from "@pi-harness/contracts";
import { saveDelegationReceipt, loadDelegationReceipt, hasReceipt, } from "@pi-harness/contracts";
/**
 * Create delegation harness integration
 */
export function createDelegationHarness(pi, config = {}) {
    const state = {
        currentReceipt: null,
        capability: null,
        lastAssessment: null,
    };
    const minFiles = config.minFiles ?? 10;
    const minCallSites = config.minCallSites ?? 50;
    const minComponents = config.minComponents ?? 2;
    /**
     * Discover and cache delegation capability
     */
    async function discoverCapability() {
        if (state.capability) {
            return state.capability;
        }
        state.capability = await discoverDelegationCapability(pi);
        return state.capability;
    }
    /**
     * Check if delegation assessment should be triggered
     */
    function shouldAssess(facts) {
        if (facts.observedFiles >= minFiles)
            return true;
        if (facts.observedCallSites >= minCallSites)
            return true;
        if (facts.independentComponents >= minComponents)
            return true;
        return false;
    }
    /**
     * Assess delegation for given scope facts
     */
    async function assess(facts, parentTaskId) {
        // Check if assessment should trigger
        if (!shouldAssess(facts)) {
            return null;
        }
        // Check for existing receipt (avoid reassessment)
        const workspacePath = process.cwd();
        if (hasReceipt(workspacePath, parentTaskId)) {
            const existing = loadDelegationReceipt(workspacePath, parentTaskId);
            if (existing && existing.scopeFingerprint === facts.fingerprint) {
                state.currentReceipt = existing;
                return existing.decision;
            }
        }
        // Discover capability
        const capability = await discoverCapability();
        // Make assessment
        const decision = makeDeterministicAssessment(facts, capability);
        state.lastAssessment = decision;
        // Create receipt
        const receipt = {
            version: 1,
            workspacePath,
            sessionId: pi.getSessionName?.() ?? "unknown",
            parentTaskId,
            scopeFingerprint: facts.fingerprint,
            decision,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: "assessing",
            childIds: [],
            pendingValidation: [],
            userConstraints: [],
        };
        // Save receipt
        saveDelegationReceipt(receipt);
        state.currentReceipt = receipt;
        return decision;
    }
    /**
     * Get current receipt
     */
    function getReceipt() {
        return state.currentReceipt;
    }
    /**
     * Get current assessment decision
     */
    function getLastDecision() {
        return state.lastAssessment;
    }
    /**
     * Clear cached state (on session switch)
     */
    function clear() {
        state.currentReceipt = null;
        state.lastAssessment = null;
    }
    return {
        discoverCapability,
        shouldAssess,
        assess,
        getReceipt,
        getLastDecision,
        clear,
    };
}
//# sourceMappingURL=delegation-harness.js.map
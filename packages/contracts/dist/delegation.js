/**
 * Delegation Assessment Types
 *
 * Types for consistent delegation assessment for large refactors.
 */
/**
 * Default trigger config
 */
export const DEFAULT_DELEGATION_TRIGGERS = {
    minFiles: 10,
    minCallSites: 50,
    minIndependentComponents: 2,
    assessOnDiscovery: true,
};
/**
 * Check if delegation should be triggered
 */
export function shouldTriggerAssessment(facts, config = DEFAULT_DELEGATION_TRIGGERS) {
    // Check file count
    if (facts.observedFiles >= config.minFiles)
        return true;
    if (facts.estimatedFiles >= config.minFiles)
        return true;
    // Check call sites
    if (facts.observedCallSites >= config.minCallSites)
        return true;
    if (facts.estimatedCallSites >= config.minCallSites)
        return true;
    // Check independent components
    if (facts.independentComponents >= config.minIndependentComponents)
        return true;
    return false;
}

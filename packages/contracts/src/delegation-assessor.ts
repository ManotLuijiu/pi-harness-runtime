/**
 * Delegation Assessor
 * 
 * Assesses whether work should be delegated to sub-agents based on scope.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  ScopeFacts,
  DelegationDecision,
  DelegationStrategy,
  WorkGroup,
  DelegationTriggerConfig,
  ExtensionCapability,
  DEFAULT_DELEGATION_TRIGGERS,
} from "./delegation.js";
import { shouldTriggerAssessment } from "./delegation.js";

/**
 * Sub-agent extension names to check for
 */
const SUBAGENT_EXTENSIONS = [
  "pi-subagents",
  "@earendil-works/pi-subagents",
  "subagent",
  "spawn",
  "delegate",
];

/**
 * Tool names that indicate sub-agent capability
 */
const SUBAGENT_TOOLS = [
  "subagent",
  "spawn",
  "delegate",
  "run_subagent",
  "run_agent",
];

/**
 * Discover extension capabilities for delegation
 */
export async function discoverDelegationCapability(
  pi: ExtensionAPI
): Promise<ExtensionCapability | null> {
  // Get all available tools
  const allTools = pi.getAllTools();
  const toolNames = allTools.map((t) => t.name);
  const activeTools = pi.getActiveTools();

  // Check for sub-agent tools
  const hasSubagentTool = SUBAGENT_TOOLS.some(
    (tool) => toolNames.includes(tool) || activeTools.includes(tool)
  );

  // Check for subagent extension registration
  // The extension might register tools under different names
  const possibleCapabilities: ExtensionCapability[] = [];

  // Verify by attempting a capability check
  // If subagent tools exist, assume capability
  if (hasSubagentTool) {
    return {
      name: "subagent-extension",
      supportsSubagents: true,
      supportsWorkIsolation: true, // Assume based on tool presence
      supportsCancellation: true,
      availableTools: activeTools.filter((t) =>
        SUBAGENT_TOOLS.some((st) => t.includes(st))
      ),
      verified: true,
    };
  }

  // Check if pi-subagents skill is mentioned in available tools
  const subagentMentioned = toolNames.some(
    (t) => t.includes("subagent") || t.includes("spawn")
  );

  if (subagentMentioned) {
    return {
      name: "pi-subagents",
      supportsSubagents: true,
      supportsWorkIsolation: true,
      supportsCancellation: true,
      availableTools: toolNames.filter((t) => t.includes("subagent")),
      verified: false, // Not verified - just mentioned
    };
  }

  return null;
}

/**
 * Estimate scope from file analysis
 */
export async function estimateScope(
  _pi: ExtensionAPI,
  patterns: string[]
): Promise<ScopeFacts> {
  // TODO: Implement actual file discovery
  // For now, return placeholder
  return {
    estimatedFiles: patterns.length,
    observedFiles: 0,
    estimatedCallSites: 0,
    observedCallSites: 0,
    independentComponents: 1,
    tightlyCoupled: false,
    isMechanical: true,
    isComplex: false,
    fileTypes: {},
    fingerprint: "",
  };
}

/**
 * Make deterministic assessment without Jev
 */
export function makeDeterministicAssessment(
  facts: ScopeFacts,
  capability: ExtensionCapability | null
): DelegationDecision {
  // No capability - must use single agent
  if (!capability?.verified) {
    return {
      strategy: "unavailable",
      reason: "No verified sub-agent capability available",
      workGroups: [],
      validationExpectations: "Parent handles all validation",
      confidence: "high",
      jevUsed: false,
      reassessmentTriggers: ["Extension becomes available"],
    };
  }

  // Small scope - single agent
  if (facts.observedFiles < 5 && facts.observedCallSites < 20) {
    return {
      strategy: "single_agent",
      reason: "Small scope - delegation overhead not justified",
      workGroups: [],
      validationExpectations: "Standard parent validation",
      confidence: "high",
      jevUsed: false,
      reassessmentTriggers: [],
    };
  }

  // Mechanical transformation with reliable script
  if (facts.isMechanical && !facts.isComplex) {
    return {
      strategy: "script_only",
      reason: "Mechanical transformation - script approach is reliable",
      workGroups: [],
      validationExpectations: "Script output validation + test run",
      confidence: "high",
      jevUsed: false,
      reassessmentTriggers: ["Transformation proves unreliable"],
    };
  }

  // Multiple independent components
  if (facts.independentComponents >= 2 && !facts.tightlyCoupled) {
    const groups = partitionIntoGroups(facts);
    return {
      strategy: "delegate",
      reason: `${facts.independentComponents} independent components - delegation recommended`,
      workGroups: groups,
      validationExpectations: "Each group validated independently, then integrated",
      confidence: "medium",
      jevUsed: false,
      reassessmentTriggers: ["Scope expands significantly", "Component coupling discovered"],
    };
  }

  // Tightly coupled - sequential or single agent
  if (facts.tightlyCoupled) {
    return {
      strategy: "script_then_delegate",
      reason: "Coupled components - script shared parts, delegate isolated changes",
      workGroups: [],
      validationExpectations: "Script validates shared API, delegate validates components",
      confidence: "medium",
      jevUsed: false,
      reassessmentTriggers: ["Coupling reduced after refactoring"],
    };
  }

  // Default - single agent with monitoring
  return {
    strategy: "single_agent",
    reason: "Default to single agent for bounded scope",
    workGroups: [],
    validationExpectations: "Parent validates all changes",
    confidence: "low",
    jevUsed: false,
    reassessmentTriggers: ["Scope exceeds threshold"],
  };
}

/**
 * Partition work into groups
 */
function partitionIntoGroups(facts: ScopeFacts): WorkGroup[] {
  const groups: WorkGroup[] = [];
  const filesPerGroup = Math.ceil(facts.observedFiles / facts.independentComponents);

  for (let i = 0; i < facts.independentComponents; i++) {
    groups.push({
      groupId: `group-${i + 1}`,
      description: `Component ${i + 1} of ${facts.independentComponents}`,
      ownedPaths: [], // TODO: Populate with actual files
      isMechanical: facts.isMechanical,
      status: "pending",
    });
  }

  return groups;
}

/**
 * Assess delegation need
 */
export async function assessDelegation(
  pi: ExtensionAPI,
  facts: ScopeFacts,
  config: DelegationTriggerConfig = { minFiles: 10, minCallSites: 50, minIndependentComponents: 2, assessOnDiscovery: true }
): Promise<DelegationDecision | null> {
  // Check if assessment should trigger
  if (!shouldTriggerAssessment(facts, config)) {
    return null; // No assessment needed
  }

  // Discover capability
  const capability = await discoverDelegationCapability(pi);

  // Make deterministic assessment
  return makeDeterministicAssessment(facts, capability);
}

/**
 * Validate assessment is still valid
 */
export function isAssessmentStale(
  decision: DelegationDecision,
  currentFacts: ScopeFacts,
  originalFacts: ScopeFacts
): boolean {
  // Scope significantly expanded
  if (currentFacts.observedFiles > originalFacts.observedFiles * 1.5) {
    return true;
  }

  // New coupling discovered
  if (currentFacts.tightlyCoupled && !originalFacts.tightlyCoupled) {
    return true;
  }

  // Reassessment triggers
  return decision.reassessmentTriggers.some((trigger) => {
    if (trigger.includes("scope expands")) {
      return currentFacts.observedFiles > originalFacts.observedFiles * 1.5;
    }
    return false;
  });
}

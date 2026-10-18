/**
 * Delegation Harness Integration
 * 
 * Connects delegation assessment to the harness runtime.
 * Uses inline types to avoid cross-package dependency.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

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
export type DelegationStrategy =
  | "delegate"
  | "script_then_delegate"
  | "script_only"
  | "single_agent"
  | "unavailable";

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
 * Store directory path
 */
const STORE_DIR = join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "delegation-state");

/**
 * Ensure store directory exists
 */
function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

/**
 * Get receipt file path
 */
function getReceiptPath(workspacePath: string, taskId: string): string {
  const safePath = workspacePath.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-100);
  const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(STORE_DIR, `${safePath}__${safeTask}.json`);
}

/**
 * Save delegation receipt
 */
function saveReceipt(receipt: DelegationReceipt): void {
  ensureStoreDir();
  const path = getReceiptPath(receipt.workspacePath, receipt.parentTaskId);
  writeFileSync(path, JSON.stringify(receipt, null, 2), "utf8");
}

/**
 * Load delegation receipt
 */
function loadReceipt(workspacePath: string, taskId: string): DelegationReceipt | null {
  const path = getReceiptPath(workspacePath, taskId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DelegationReceipt;
  } catch {
    return null;
  }
}

/**
 * Check if receipt exists
 */
function hasReceipt(workspacePath: string, taskId: string): boolean {
  return existsSync(getReceiptPath(workspacePath, taskId));
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
 * Delegation harness state
 */
interface DelegationState {
  currentReceipt: DelegationReceipt | null;
  capability: ExtensionCapability | null;
  lastAssessment: DelegationDecision | null;
}

/**
 * Sub-agent tool names
 */
const SUBAGENT_TOOLS = ["subagent", "spawn", "delegate", "run_subagent"];

/**
 * Create delegation harness integration
 */
export function createDelegationHarness(
  pi: ExtensionAPI,
  config: DelegationHarnessConfig = {}
) {
  const state: DelegationState = {
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
  async function discoverCapability(): Promise<ExtensionCapability | null> {
    if (state.capability) return state.capability;

    try {
      const allTools = pi.getAllTools();
      const toolNames = allTools.map((t) => t.name);
      const activeTools = pi.getActiveTools();

      const hasSubagentTool = SUBAGENT_TOOLS.some(
        (tool) => toolNames.includes(tool) || activeTools.includes(tool)
      );

      if (hasSubagentTool) {
        state.capability = {
          name: "subagent-extension",
          supportsSubagents: true,
          supportsWorkIsolation: true,
          supportsCancellation: true,
          availableTools: activeTools.filter((t) =>
            SUBAGENT_TOOLS.some((st) => t.includes(st))
          ),
          verified: true,
        };
        return state.capability;
      }
    } catch {
      // Discovery failed
    }

    return null;
  }

  /**
   * Check if delegation assessment should be triggered
   */
  function shouldAssess(facts: ScopeFacts): boolean {
    if (facts.observedFiles >= minFiles) return true;
    if (facts.observedCallSites >= minCallSites) return true;
    if (facts.independentComponents >= minComponents) return true;
    return false;
  }

  /**
   * Make deterministic assessment
   */
  function makeDeterministicAssessment(
    facts: ScopeFacts,
    capability: ExtensionCapability | null
  ): DelegationDecision {
    if (!capability?.verified) {
      return {
        strategy: "unavailable",
        reason: "No verified sub-agent capability",
        workGroups: [],
        validationExpectations: "Parent handles validation",
        confidence: "high",
        jevUsed: false,
        reassessmentTriggers: ["Extension available"],
      };
    }

    if (facts.isMechanical && !facts.isComplex) {
      return {
        strategy: "script_only",
        reason: "Mechanical transformation",
        workGroups: [],
        validationExpectations: "Script output validation",
        confidence: "high",
        jevUsed: false,
        reassessmentTriggers: ["Transformation unreliable"],
      };
    }

    if (facts.independentComponents >= 2 && !facts.tightlyCoupled) {
      return {
        strategy: "delegate",
        reason: `${facts.independentComponents} independent components`,
        workGroups: [],
        validationExpectations: "Each group validated, then integrated",
        confidence: "medium",
        jevUsed: false,
        reassessmentTriggers: ["Scope expands", "Coupling discovered"],
      };
    }

    return {
      strategy: "single_agent",
      reason: "Default to single agent",
      workGroups: [],
      validationExpectations: "Parent validates",
      confidence: "low",
      jevUsed: false,
      reassessmentTriggers: ["Scope exceeds threshold"],
    };
  }

  /**
   * Assess delegation for given scope facts
   */
  async function assess(
    facts: ScopeFacts,
    parentTaskId: string
  ): Promise<DelegationDecision | null> {
    if (!shouldAssess(facts)) return null;

    const workspacePath = process.cwd();

    // Check existing receipt
    if (hasReceipt(workspacePath, parentTaskId)) {
      const existing = loadReceipt(workspacePath, parentTaskId);
      if (existing && existing.scopeFingerprint === facts.fingerprint) {
        state.currentReceipt = existing;
        return existing.decision;
      }
    }

    const capability = await discoverCapability();
    const decision = makeDeterministicAssessment(facts, capability);
    state.lastAssessment = decision;

    const receipt: DelegationReceipt = {
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

    saveReceipt(receipt);
    state.currentReceipt = receipt;
    return decision;
  }

  return {
    discoverCapability,
    shouldAssess,
    assess,
    getReceipt: () => state.currentReceipt,
    getLastDecision: () => state.lastAssessment,
    clear: () => {
      state.currentReceipt = null;
      state.lastAssessment = null;
    },
  };
}

export type DelegationHarness = ReturnType<typeof createDelegationHarness>;

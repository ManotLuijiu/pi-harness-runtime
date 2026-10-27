/**
 * Delegation Harness Integration
 * 
 * Connects delegation assessment to the harness runtime.
 * Uses inline types to avoid cross-package dependency.
 */

import { homedir as osHomedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScopeMeasurement, ScopeWorkGroup } from "./delegation-scope.js";
import { DelegationObserver, type DelegationChild } from "./delegation-observer.js";

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
 * Store directory path
 */
const STORE_DIR = join(process.env.HOME || osHomedir(), ".pi-harness-runtime", "delegation-state");

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
 * The number of groups that can be handed to children at once.
 *
 * More groups than that is not a delegation plan: it is a list of files
 * that still needs a decision about the order.
 */
const MAX_DELEGATED_GROUPS = 8;

/**
 * Build the scope facts from a measurement.
 *
 * Every number is a count of something the measurement found. The
 * estimate is the size of the workspace: it is a real number, and it says
 * how much of the repository the measured files are.
 */
export function scopeFactsFromMeasurement(measurement: ScopeMeasurement): ScopeFacts {
	const groups = measurement.groups;
	const extensions = Object.keys(measurement.fileTypes);
	return {
		estimatedFiles: measurement.workspaceFiles,
		observedFiles: measurement.files.length,
		estimatedCallSites: measurement.callSites,
		observedCallSites: measurement.callSites,
		independentComponents: groups.length,
		tightlyCoupled: groups.length <= 1,
		// A mechanical change touches one kind of file, and there is more
		// than one of them: a rename across many files is mechanical, a
		// single file is just work.
		isMechanical: extensions.length === 1 && measurement.files.length >= 3,
		// A complex change spans more than one module.
		isComplex: groups.length > 1,
		fileTypes: measurement.fileTypes,
		fingerprint: measurement.fingerprint,
		workGroups: groups,
	};
}

/**
 * The reason why the work stays in the session.
 */
function singleAgentReason(groups: ScopeWorkGroup[]): string {
  if (groups.length === 1) {
    return `One measured group (${groups[0].id}): the work stays in this session`;
  }
  if (groups.length > MAX_DELEGATED_GROUPS) {
    return `${groups.length} measured groups: too many to hand out at once, the work stays in this session`;
  }
  return "No measured group of work: the work stays in this session";
}

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
export function buildDelegationSteer(
  decision: {
    strategy: string;
    workGroups?: { id: string; files: string[] }[];
    dispatchTool?: string;
  } | null,
): string | null {
  if (!decision) return null;
  if (decision.strategy !== "delegate") return null;
  const groups = decision.workGroups ?? [];
  if (groups.length === 0) return null;

  const lines = [
    `[Delegation plan] The measured scope of this request falls into ${groups.length} independent group(s):`,
    ...groups.map((group) => `- ${group.id} (${group.files.length} file(s))`),
  ];
  if (decision.dispatchTool) {
    lines.push(
      `Send each group to a child agent with the ${decision.dispatchTool} tool, then integrate the results and validate them.`,
    );
  } else {
    lines.push("Send each group to a child agent, then integrate the results and validate them.");
  }
  lines.push("The harness measured the scope; it did not dispatch the groups itself.");
  return lines.join("\n");
}

/**
 * The parameters of a tool that dispatch a child.
 *
 * A tool that takes the task of a child can dispatch one. The name of the
 * tool says nothing about that: only the schema does.
 */
const DISPATCH_PARAMETERS = ["task", "prompt", "instructions", "description"];

/**
 * The parameters of a tool that isolate the work of a child.
 */
const ISOLATION_PARAMETERS = ["cwd", "worktree", "isolation", "sandbox", "branch"];

/**
 * The parameters of a tool that stop a child.
 */
const CANCELLATION_PARAMETERS = ["timeout", "timeoutMs", "cancel", "signal", "abort"];

/**
 * The words that name a child agent.
 */
const CHILD_WORDS = ["subagent", "sub-agent", "child agent", "delegate", "spawn"];

/**
 * The property names of a tool schema.
 *
 * A schema is a plain object: the properties of the object, of every
 * branch of a union, and of every item of an array.
 */
export function schemaPropertyNames(schema: unknown): Set<string> {
	const names = new Set<string>();
	const visit = (node: unknown): void => {
		if (!node || typeof node !== "object") return;
		const record = node as Record<string, unknown>;
		const properties = record.properties;
		if (properties && typeof properties === "object") {
			for (const name of Object.keys(properties as Record<string, unknown>)) {
				names.add(name);
			}
		}
		for (const branch of ["anyOf", "oneOf", "allOf"]) {
			const list = record[branch];
			if (Array.isArray(list)) for (const entry of list) visit(entry);
		}
		const items = record.items;
		if (items) visit(items);
	};
	visit(schema);
	return names;
}

/**
 * The text of a tool that names what the tool is for.
 */
function toolText(tool: { name?: string; description?: string }): string {
	return `${tool.name ?? ""} ${tool.description ?? ""}`.toLowerCase();
}

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
  // The children that were really dispatched, as they were observed.
  const observer = new DelegationObserver();

  const minFiles = config.minFiles ?? 10;
  const minCallSites = config.minCallSites ?? 50;
  const minComponents = config.minComponents ?? 2;

  /**
   * Discover and cache delegation capability
   *
   * The capability is read from the schema of the tools, not from their
   * names: a tool that carries the task of a child can dispatch one, and
   * only a schema that carries a working directory or a timeout proves
   * that the work can be isolated or stopped.
   */
  async function discoverCapability(): Promise<ExtensionCapability | null> {
    if (state.capability) return state.capability;

    try {
      const allTools = pi.getAllTools();
      const activeTools = new Set(pi.getActiveTools());

      for (const tool of allTools) {
        const properties = schemaPropertyNames(tool.parameters);
        const dispatches = DISPATCH_PARAMETERS.some((parameter) => properties.has(parameter));
        if (!dispatches) continue;
        // The tool has to be about a child agent: a schema that takes a
        // task is not enough when the tool is something else entirely.
        const text = toolText(tool);
        if (!CHILD_WORDS.some((word) => text.includes(word))) continue;

        const isolation = ISOLATION_PARAMETERS.find((parameter) => properties.has(parameter));
        const cancellation = CANCELLATION_PARAMETERS.find((parameter) => properties.has(parameter));
        const isActive = activeTools.has(tool.name);

        state.capability = {
          name: tool.name,
          toolName: tool.name,
          supportsSubagents: true,
          supportsWorkIsolation: isolation !== undefined,
          supportsCancellation: cancellation !== undefined,
          availableTools: isActive ? [tool.name] : [],
          // The capability is verified when the tool is active: an inactive
          // tool cannot dispatch anything.
          verified: isActive,
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
   *
   * The thresholds are compared with the measured scope. A scope that was
   * not measured is never assessed: an empty measurement is not a small
   * task, it is an unknown one.
   */
  function shouldAssess(facts: ScopeFacts): boolean {
    if (facts.observedFiles <= 0) return false;
    if (facts.observedFiles >= minFiles) return true;
    if (facts.observedCallSites >= minCallSites) return true;
    if (facts.independentComponents >= minComponents) return true;
    return false;
  }

  /**
   * Make deterministic assessment
   *
   * The decision is built from the measured scope and from the schema of
   * the tools. A strategy that claims a delegation needs the groups of the
   * measurement: without them there is nothing to hand to a child.
   */
  function makeDeterministicAssessment(
    facts: ScopeFacts,
    capability: ExtensionCapability | null
  ): DelegationDecision {
    if (!capability?.verified) {
      return {
        strategy: "unavailable",
        reason: "No active tool can dispatch a child agent",
        workGroups: [],
        validationExpectations: "Parent handles validation",
        confidence: "high",
        jevUsed: false,
        dispatched: false,
        reassessmentTriggers: ["Extension available"],
      };
    }

    if (facts.isMechanical && !facts.isComplex) {
      return {
        strategy: "script_only",
        reason: `Mechanical transformation of ${facts.observedFiles} measured file(s)`,
        workGroups: [],
        validationExpectations: "Script output validation",
        confidence: "high",
        jevUsed: false,
        dispatched: false,
        reassessmentTriggers: ["Transformation unreliable"],
      };
    }

    const groups = facts.workGroups ?? [];
    if (groups.length >= 2 && groups.length <= MAX_DELEGATED_GROUPS && !facts.tightlyCoupled) {
      return {
        strategy: "delegate",
        reason: `${groups.length} measured groups over ${facts.observedFiles} file(s); the agent dispatches the groups`,
        workGroups: groups,
        validationExpectations: "Each group validated, then integrated",
        confidence: "medium",
        jevUsed: false,
        // The harness measured the groups, it did not dispatch them.
        dispatched: false,
        dispatchTool: capability.toolName,
        reassessmentTriggers: ["Scope expands", "Coupling discovered"],
      };
    }

    return {
      strategy: "single_agent",
      reason: singleAgentReason(groups),
      workGroups: groups,
      validationExpectations: "Parent validates",
      confidence: "low",
      jevUsed: false,
      dispatched: false,
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
      children: [],
      pendingValidation: [],
      userConstraints: [],
    };

    saveReceipt(receipt);
    state.currentReceipt = receipt;
    // The observer watches the tool that the plan names: the children it
    // records are the ones the agent really dispatched.
    if (decision.strategy === "delegate" && decision.dispatchTool) {
      observer.setPlan(
        decision.dispatchTool,
        decision.workGroups.map((group) => group.id),
      );
    }
    return decision;
  }

  /**
   * A tool call started.
   *
   * The call is a child of the current plan when the tool is the one
   * that the plan named. The child is recorded, and the receipt says
   * that a delegation is really under way.
   */
  function observeToolStart(event: {
    toolCallId: string;
    toolName: string;
    args?: unknown;
  }): DelegationChild | null {
    const child = observer.noteStart(event);
    if (!child) return null;
    updateReceiptWithChildren();
    return child;
  }

  /**
   * A tool call ended.
   */
  function observeToolEnd(event: {
    toolCallId: string;
    toolName: string;
    result?: unknown;
    isError?: boolean;
  }): DelegationChild | null {
    const child = observer.noteEnd(event);
    if (!child) return null;
    updateReceiptWithChildren();
    return child;
  }

  /**
   * The children that were really dispatched.
   */
  function getChildren(): DelegationChild[] {
    return observer.observed();
  }

  /**
   * Write the observed children into the receipt.
   *
   * A child that was observed is the proof that a delegation happened.
   * Without one, the decision keeps saying that nothing was dispatched.
   */
  function updateReceiptWithChildren(): void {
    const receipt = state.currentReceipt;
    if (!receipt) return;
    const children = observer.observed();
    if (children.length === 0) return;
    receipt.children = children;
    receipt.childIds = children.map((child) => child.toolCallId);
    receipt.status = "in_progress";
    receipt.updatedAt = Date.now();
    receipt.decision = { ...receipt.decision, dispatched: true };
    saveReceipt(receipt);
  }

  return {
    discoverCapability,
    shouldAssess,
    assess,
    observeToolStart,
    observeToolEnd,
    getChildren,
    getReceipt: () => state.currentReceipt,
    getLastDecision: () => state.lastAssessment,
    clear: () => {
      state.currentReceipt = null;
      state.lastAssessment = null;
    },
  };
}

export type DelegationHarness = ReturnType<typeof createDelegationHarness>;

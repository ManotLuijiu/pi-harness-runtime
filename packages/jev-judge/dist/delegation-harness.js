/**
 * Delegation Harness Integration
 *
 * Connects delegation assessment to the harness runtime.
 * Uses inline types to avoid cross-package dependency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
/**
 * Store directory path
 */
const STORE_DIR = join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "delegation-state");
/**
 * Ensure store directory exists
 */
function ensureStoreDir() {
    if (!existsSync(STORE_DIR)) {
        mkdirSync(STORE_DIR, { recursive: true });
    }
}
/**
 * Get receipt file path
 */
function getReceiptPath(workspacePath, taskId) {
    const safePath = workspacePath.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-100);
    const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(STORE_DIR, `${safePath}__${safeTask}.json`);
}
/**
 * Save delegation receipt
 */
function saveReceipt(receipt) {
    ensureStoreDir();
    const path = getReceiptPath(receipt.workspacePath, receipt.parentTaskId);
    writeFileSync(path, JSON.stringify(receipt, null, 2), "utf8");
}
/**
 * Load delegation receipt
 */
function loadReceipt(workspacePath, taskId) {
    const path = getReceiptPath(workspacePath, taskId);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
/**
 * Check if receipt exists
 */
function hasReceipt(workspacePath, taskId) {
    return existsSync(getReceiptPath(workspacePath, taskId));
}
/**
 * Sub-agent tool names
 */
const SUBAGENT_TOOLS = ["subagent", "spawn", "delegate", "run_subagent"];
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
        if (state.capability)
            return state.capability;
        try {
            const allTools = pi.getAllTools();
            const toolNames = allTools.map((t) => t.name);
            const activeTools = pi.getActiveTools();
            const hasSubagentTool = SUBAGENT_TOOLS.some((tool) => toolNames.includes(tool) || activeTools.includes(tool));
            if (hasSubagentTool) {
                state.capability = {
                    name: "subagent-extension",
                    supportsSubagents: true,
                    supportsWorkIsolation: true,
                    supportsCancellation: true,
                    availableTools: activeTools.filter((t) => SUBAGENT_TOOLS.some((st) => t.includes(st))),
                    verified: true,
                };
                return state.capability;
            }
        }
        catch {
            // Discovery failed
        }
        return null;
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
     * Make deterministic assessment
     */
    function makeDeterministicAssessment(facts, capability) {
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
    async function assess(facts, parentTaskId) {
        if (!shouldAssess(facts))
            return null;
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
//# sourceMappingURL=delegation-harness.js.map
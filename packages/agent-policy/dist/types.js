/**
 * Core types for the agent-policy package.
 *
 * These types define the policy delivery and enforcement model:
 * - PolicyManifest: describes the loaded rules (hashed, scoped, trusted)
 * - PolicyReceipt: proves a session received a specific revision
 * - HarnessRulesTool: the tool for retrieving and acknowledging rules
 * - MinimaxFindingEnvelope: LSP/code analysis verdict for tool results
 */
/**
 * Check if a receipt covers a given manifest.
 */
export function receiptCoversManifest(receipt, manifest) {
    return (receipt.projectRoot === manifest.projectRoot &&
        receipt.revision === manifest.revision &&
        receipt.scope === getScopeFromManifest(manifest));
}
/**
 * Extract scope from manifest sources.
 */
export function getScopeFromManifest(manifest) {
    // Return the most specific (narrowest) scope from mandatory sources
    const mandatorySources = manifest.sources.filter(s => s.priority === "mandatory");
    if (mandatorySources.length === 0)
        return "";
    // Sort by scope length descending (most specific first)
    mandatorySources.sort((a, b) => b.scope.length - a.scope.length);
    return mandatorySources[0]?.scope ?? "";
}
/**
 * Default tool classifier for pi-harness.
 * Classifies actual capability, not just literal tool names.
 */
export function classifyToolCall(toolName, input) {
    const inputObj = input;
    switch (toolName) {
        case "write":
        case "edit":
        case "multi-edit":
            return {
                mutatesProject: true,
                releasesProject: false,
                affectedPaths: inputObj?.path ? [String(inputObj.path)] : undefined,
                isChildDelegation: false,
                confidence: "high",
            };
        case "bash":
        case "shell":
        case "ctx_execute":
        case "ctx_execute_file": {
            const command = String(inputObj?.command ?? "");
            const path = String(inputObj?.path ?? "");
            // Check for git operations
            if (/^git\s+(commit|push|checkout|reset|clean|merge|rebase)/.test(command)) {
                return {
                    mutatesProject: true,
                    releasesProject: true,
                    affectedPaths: path ? [path] : undefined,
                    isChildDelegation: false,
                    confidence: "high",
                };
            }
            // Check for build/release commands
            if (/^(npm|bun|yarn|pnpm)\s+(run|build|test|publish|deploy)/.test(command) ||
                /^(cargo|go|make|gradle|mvn)\s+(build|test|run)/.test(command)) {
                return {
                    mutatesProject: command.includes("--watch") || command.includes("-o "),
                    releasesProject: true,
                    affectedPaths: path ? [path] : undefined,
                    isChildDelegation: false,
                    confidence: "high",
                };
            }
            // General shell commands can modify files
            return {
                mutatesProject: true,
                releasesProject: false,
                affectedPaths: path ? [path] : undefined,
                isChildDelegation: false,
                confidence: "medium",
            };
        }
        case "subagent":
        case "spawn":
        case "delegate": {
            // Child agent delegation is a mutation-equivalent operation
            return {
                mutatesProject: true,
                releasesProject: false,
                affectedPaths: undefined,
                isChildDelegation: true,
                confidence: "high",
            };
        }
        case "read":
        case "glob":
        case "grep":
        case "search":
        case "symbol_search":
        case "find":
        case "lens_diagnostics":
        case "module_report":
        case "project_report":
            return {
                mutatesProject: false,
                releasesProject: false,
                affectedPaths: inputObj?.path ? [String(inputObj.path)] : undefined,
                isChildDelegation: false,
                confidence: "high",
            };
        case "harness_rules":
            return {
                mutatesProject: false,
                releasesProject: false,
                affectedPaths: undefined,
                isChildDelegation: false,
                confidence: "high",
            };
        default:
            // Unknown tools: conservative assumption
            return {
                mutatesProject: true,
                releasesProject: false,
                affectedPaths: undefined,
                isChildDelegation: false,
                confidence: "low",
            };
    }
}
//# sourceMappingURL=types.js.map
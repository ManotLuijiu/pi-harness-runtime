/**
 * Agent Policy Package
 *
 * Provides mandatory policy delivery and mutation gating for pi-harness.
 *
 * @example
 * ```ts
 * import { registerAgentPolicy } from "@pi/agent-policy";
 *
 * export default function (pi: ExtensionAPI) {
 *   registerAgentPolicy(pi, {
 *     harnessRulesPath: new URL("./AGENTS.md", import.meta.url),
 *     requireReceiptBeforeMutation: true,
 *     lspMode: "pi-lens",
 *   });
 * }
 * ```
 */
// Policy Components
export { PolicyLoader, createPolicyLoader } from "./policy-loader.js";
export { PolicyStore, getPolicyStore, resetPolicyStore } from "./policy-store.js";
export { renderSystemContract, renderFullRules, renderManifestSummary, renderFindingEnvelope, parseSections, createCleanEnvelope, createDegradedEnvelope, } from "./policy-renderer.js";
// Extension Registration
export { registerAgentPolicy, registerDefault } from "./extension.js";
// Tool Classifier
export { classifyToolCall } from "./types.js";
//# sourceMappingURL=index.js.map
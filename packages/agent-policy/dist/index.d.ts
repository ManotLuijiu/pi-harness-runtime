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
export type { AgentPolicyConfig, HarnessRulesInput, HarnessRulesOutput, MinimaxFindingEnvelope, PolicyFinding, PolicyManifest, PolicyReceipt, PolicySection, PolicySource, ToolCallCapability, HarnessAgentVerdict, } from "./types.js";
export { PolicyLoader, createPolicyLoader } from "./policy-loader.js";
export { PolicyStore, getPolicyStore, resetPolicyStore } from "./policy-store.js";
export { renderSystemContract, renderFullRules, renderManifestSummary, renderFindingEnvelope, parseSections, createCleanEnvelope, createDegradedEnvelope, } from "./policy-renderer.js";
export { registerAgentPolicy, registerDefault } from "./extension.js";
export { classifyToolCall } from "./types.js";
//# sourceMappingURL=index.d.ts.map
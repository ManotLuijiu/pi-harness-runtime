/**
 * PolicyRenderer - Renders compact system contract for agent injection.
 *
 * Responsibilities:
 * - Render a compact, deterministic contract for before_agent_start injection
 * - Render full rule text for the harness_rules tool
 * - Render policy status for display
 */
import type { PolicyManifest, PolicySection, HarnessRulesOutput, MinimaxFindingEnvelope } from "./types.js";
/**
 * Render the compact mandatory contract for system prompt injection.
 */
export declare function renderSystemContract(manifest: PolicyManifest): string;
/**
 * Parse markdown content into sections.
 */
export declare function parseSections(content: string, source: string, scope: string, priority: "mandatory" | "advisory"): PolicySection[];
/**
 * Render full policy text for injection after compaction.
 * This includes the ACTUAL rule file contents, not just a contract pointer.
 * Used after session_compact to deliver fresh policy text to the model.
 */
export declare function renderFullPolicyText(manifest: PolicyManifest): string;
/**
 * Check if full policy text would fit in context.
 * Returns { fits: true } or { fits: false, reason: string, bytes: number }.
 */
export declare function checkPolicyTextSize(manifest: PolicyManifest, maxBytes?: number): {
    fits: boolean;
    bytes?: number;
    reason?: string;
};
/**
 * Render full rules for the harness_rules tool.
 */
export declare function renderFullRules(manifest: PolicyManifest, options?: {
    source?: string;
    section?: string;
    maxBytes?: number;
}): HarnessRulesOutput;
/**
 * Render a manifest summary.
 */
export declare function renderManifestSummary(manifest: PolicyManifest): string;
/**
 * Render a finding envelope for display.
 */
export declare function renderFindingEnvelope(envelope: MinimaxFindingEnvelope): string;
/**
 * Create a clean finding envelope.
 */
export declare function createCleanEnvelope(coverage?: "delta" | "targeted" | "full"): MinimaxFindingEnvelope;
/**
 * Create a degraded finding envelope.
 */
export declare function createDegradedEnvelope(reason: string, coverage?: "delta" | "targeted" | "full"): MinimaxFindingEnvelope;
//# sourceMappingURL=policy-renderer.d.ts.map
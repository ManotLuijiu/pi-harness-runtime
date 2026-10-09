/**
 * Agent Policy Extension
 *
 * Registers the policy runtime with Pi's event system:
 * - before_agent_start: inject system contract
 * - tool_call: gate mutations until policy received
 * - harness_rules tool: retrieve and acknowledge rules
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentPolicyConfig } from "./types.js";
/**
 * Register the agent policy runtime with Pi.
 */
export declare function registerAgentPolicy(pi: ExtensionAPI, config: AgentPolicyConfig): void;
/**
 * Register with default configuration pointing to harness rules.
 * Checks for AGENTS.md first, then RULES.md as fallback.
 */
export declare function registerDefault(pi: ExtensionAPI): void;
//# sourceMappingURL=extension.d.ts.map
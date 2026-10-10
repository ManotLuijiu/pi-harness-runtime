/**
 * Agent Policy Extension
 *
 * Registers the policy runtime with Pi's event system:
 * - before_agent_start: inject system contract
 * - tool_call: gate mutations until policy received
 * - harness_rules tool: retrieve and acknowledge rules
 */
import { PolicyLoader } from "./policy-loader.js";
import { getPolicyStore } from "./policy-store.js";
import { renderSystemContract, renderFullRules, } from "./policy-renderer.js";
import { classifyToolCall } from "./types.js";
import { randomUUID } from "node:crypto";
// ---------------------------------------------------------------------------
// Extension Registration
// ---------------------------------------------------------------------------
/**
 * Register the agent policy runtime with Pi.
 */
export function registerAgentPolicy(pi, config) {
    const loader = new PolicyLoader({
        harnessRulesPath: config.harnessRulesPath,
        additionalRulesPaths: config.additionalRulesPaths,
    });
    const store = getPolicyStore();
    const toolClassifier = config.toolClassifier ?? classifyToolCall;
    const fallbackSessionId = `policy-${randomUUID()}`;
    // Track if pi-lens is available
    let piLensAvailable = false;
    // Check for pi-lens availability on session start
    pi.on("session_start", async (event) => {
        // pi-lens registers its own tools, so we can check for them
        const availableTools = event.availableTools ?? [];
        piLensAvailable = availableTools.includes("lens_diagnostics");
    });
    // ---------------------------------------------------------------------------
    // before_agent_start: Inject system contract
    // ---------------------------------------------------------------------------
    pi.on("before_agent_start", async (event, ctx) => {
        const cwd = getCwdFromContext(ctx);
        try {
            const manifest = await loader.load(cwd);
            // Record delivery in store
            const sessionId = getSessionIdFromCtx(ctx, fallbackSessionId);
            const receipt = store.noteDelivered(sessionId, manifest, "system_prompt");
            // Render and inject contract
            const contract = renderSystemContract(manifest);
            // Build augmented system prompt
            const augmentedPrompt = event.systemPrompt + "\n\n" + contract;
            // Log for debugging
            console.log(`[agent-policy] Delivered policy ${manifest.revision} to session ${receipt.sessionId}`);
            return { systemPrompt: augmentedPrompt };
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[agent-policy] Failed to load policy: ${errorMessage}`);
            // Return minimal contract on failure - don't block startup
            const fallbackContract = `
PI-HARNESS POLICY coverage=degraded

WARNING: Policy loading failed. Please report this to your administrator.
Use harness_rules to check policy status.
`.trim();
            return { systemPrompt: event.systemPrompt + "\n\n" + fallbackContract };
        }
    });
    // ---------------------------------------------------------------------------
    // tool_call: Gate mutations until policy received
    // ---------------------------------------------------------------------------
    pi.on("tool_call", async (event, ctx) => {
        const toolName = event.toolName;
        const input = event.input;
        const capability = toolClassifier(toolName, input);
        // Skip non-mutating calls
        if (!capability.mutatesProject && !capability.releasesProject && !capability.isChildDelegation) {
            return {};
        }
        const cwd = getCwdFromContext(ctx);
        const sessionId = getSessionIdFromCtx(ctx, fallbackSessionId);
        const targetPath = capability.affectedPaths?.[0];
        try {
            const manifest = await loader.loadForTarget(cwd, targetPath);
            const receipt = store.getReceipt(sessionId, manifest.projectRoot);
            // Check if current revision is covered
            if (config.requireReceiptBeforeMutation && (!receipt || receipt.revision !== manifest.revision)) {
                const blockReason = receipt
                    ? `Policy revision changed (expected ${manifest.revision}, received ${receipt.revision})`
                    : `Policy revision ${manifest.revision} not yet delivered`;
                console.log(`[agent-policy] Blocked ${toolName}: ${blockReason}`);
                const reason = `[POLICY REQUIRED] ${blockReason}\n\n` +
                    `To proceed, you must acknowledge the harness rules:\n` +
                    `1. Run: harness_rules({ action: "manifest" })\n` +
                    `2. Then run: harness_rules({ action: "acknowledge", revision: "${manifest.revision}" })\n\n` +
                    `This is a one-time acknowledgment per session.`;
                return { block: true, reason };
            }
            // Optional: Check git guard
            if (config.gitGuardEnabled && capability.releasesProject) {
                // Git operations are gated by pi-lens Git guard if available
                const blockingFindings = await checkForBlockingFindings(ctx, piLensAvailable);
                if (blockingFindings) {
                    return {
                        block: true,
                        reason: `[GIT GUARD] Blocking git operation until findings are resolved.\n\n${blockingFindings}`,
                    };
                }
            }
            // Policy satisfied, allow the call
            return {};
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[agent-policy] Policy check failed: ${errorMessage}`);
            // On error, fail open for the command but log the issue
            // This matches pi-lens's total handler guard behavior
            return {};
        }
    });
    // ---------------------------------------------------------------------------
    // harness_rules tool implementation
    // ---------------------------------------------------------------------------
    pi.registerTool({
        name: "harness_rules",
        label: "Harness Rules",
        description: [
            "Retrieve and acknowledge harness policy rules.",
            "Actions:",
            "  - manifest: Show current policy status (revision, coverage, sources)",
            "  - read: Get full rule text (optionally filtered by source or section)",
            "  - acknowledge: Confirm receipt of a specific revision",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["manifest", "read", "acknowledge"],
                    description: "Action to perform",
                },
                source: {
                    type: "string",
                    description: "Source path filter (partial match) for read action",
                },
                section: {
                    type: "string",
                    description: "Section title filter for read action",
                },
                revision: {
                    type: "string",
                    description: "Revision to acknowledge",
                },
            },
            required: ["action"],
        },
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = getCwdFromContext(ctx);
            const sessionId = getSessionIdFromCtx(ctx, fallbackSessionId);
            try {
                const input = params;
                switch (input.action) {
                    case "manifest": {
                        const manifest = await loader.load(cwd);
                        return {
                            content: [{
                                    type: "text",
                                    text: JSON.stringify({ manifest }, null, 2),
                                }],
                            details: { manifest },
                        };
                    }
                    case "read": {
                        const manifest = await loader.load(cwd);
                        const result = renderFullRules(manifest, {
                            source: input.source,
                            section: input.section,
                        });
                        // Record delivery if not already recorded
                        const existingReceipt = store.getReceipt(sessionId, manifest.projectRoot);
                        if (!existingReceipt || existingReceipt.revision !== manifest.revision) {
                            store.noteDelivered(sessionId, manifest, "tool", result.sections?.map(s => s.id) ?? ["*"]);
                        }
                        // Format output as readable text
                        let output = `Harness Policy Rules (revision: ${manifest.revision})\n`;
                        output += "=".repeat(50) + "\n\n";
                        if (result.sections) {
                            for (const section of result.sections) {
                                output += `[${section.priority.toUpperCase()}] ${section.title}\n`;
                                output += `Source: ${section.source}\n`;
                                if (section.truncated) {
                                    output += "(truncated)\n";
                                }
                                output += "\n" + section.content + "\n\n";
                            }
                        }
                        return {
                            content: [{
                                    type: "text",
                                    text: output,
                                }],
                            details: { sections: result.sections },
                        };
                    }
                    case "acknowledge": {
                        const manifest = await loader.load(cwd);
                        // Reject acknowledgement of wrong revision
                        if (input.revision && input.revision !== manifest.revision) {
                            return {
                                content: [{
                                        type: "text",
                                        text: `ERROR: Cannot acknowledge revision ${input.revision}: current revision is ${manifest.revision}`,
                                    }],
                                isError: true,
                                details: { error: "revision_mismatch" },
                            };
                        }
                        // Record acknowledgement
                        const receipt = store.noteDelivered(sessionId, manifest, "tool", ["*"] // Full content acknowledged
                        );
                        return {
                            content: [{
                                    type: "text",
                                    text: `Policy acknowledged.\nRevision: ${receipt.revision}\nDelivered: ${new Date(receipt.deliveredAt).toISOString()}`,
                                }],
                            details: { receipt },
                        };
                    }
                    default: {
                        const unknownAction = input.action;
                        return {
                            content: [{
                                    type: "text",
                                    text: `ERROR: Unknown action: ${unknownAction}`,
                                }],
                            isError: true,
                            details: { error: "unknown_action" },
                        };
                    }
                }
            }
            catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error(`[agent-policy] harness_rules failed: ${errorMessage}`);
                return {
                    content: [{
                            type: "text",
                            text: `Policy operation failed: ${errorMessage}`,
                        }],
                    isError: true,
                    details: { error: errorMessage },
                };
            }
        },
    });
    // ---------------------------------------------------------------------------
    // session_start: Initialize session tracking
    // ---------------------------------------------------------------------------
    pi.on("session_start", (_event, ctx) => {
        const sessionId = getSessionIdFromCtx(ctx, fallbackSessionId);
        const cwd = getCwdFromContext(ctx);
        console.log(`[agent-policy] Session started: ${sessionId} in ${cwd}`);
    });
    // ---------------------------------------------------------------------------
    // agent_end: Cleanup
    // ---------------------------------------------------------------------------
    pi.on("agent_end", () => {
        // Cleanup is silent - verbose logging is noisy in TUI
    });
    console.log("[agent-policy] Registered agent policy runtime");
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Extract session ID from context.
 */
function getSessionIdFromCtx(ctx, fallbackSessionId) {
    const ctxObj = ctx;
    const manager = ctxObj?.sessionManager;
    const managedId = manager?.getSessionId?.();
    if (typeof managedId === "string" && managedId) {
        return managedId;
    }
    if (typeof ctxObj?.sessionId === "string") {
        return ctxObj.sessionId;
    }
    if (typeof ctxObj?.id === "string") {
        return ctxObj.id;
    }
    // Legacy hosts without session identity must reuse the registration's ID.
    return fallbackSessionId;
}
/**
 * Extract working directory from context.
 */
function getCwdFromContext(ctx) {
    const ctxObj = ctx;
    if (typeof ctxObj?.cwd === "string") {
        return ctxObj.cwd;
    }
    if (typeof ctxObj?.workingDirectory === "string") {
        return ctxObj.workingDirectory;
    }
    // Fallback to process cwd
    return process.cwd();
}
/**
 * Check for blocking findings (placeholder for pi-lens integration).
 */
async function checkForBlockingFindings(_ctx, piLensAvailable) {
    if (!piLensAvailable) {
        return null; // No blocking findings without pi-lens
    }
    // TODO: Query pi-lens for fresh blocking findings
    // This would integrate with pi-lens's finding store
    return null;
}
// ---------------------------------------------------------------------------
// Convenience Export
// ---------------------------------------------------------------------------
/**
 * Register with default configuration pointing to harness rules.
 * Checks for AGENTS.md first, then RULES.md as fallback.
 */
export function registerDefault(pi) {
    // Resolve harness rules relative to the package root (pi-harness-runtime/)
    // import.meta.url is packages/agent-policy/src/extension.ts
    // So we go up 3 levels to reach the package root
    const packageRoot = new URL("../../..", import.meta.url);
    const { existsSync } = require("node:fs");
    // Check for AGENTS.md first, then RULES.md as fallback
    const agentsPath = new URL("AGENTS.md", packageRoot);
    const rulesPath = new URL("RULES.md", packageRoot);
    const harnessRulesPath = existsSync(agentsPath) ? agentsPath : rulesPath;
    registerAgentPolicy(pi, {
        harnessRulesPath,
        requireReceiptBeforeMutation: true,
        lspMode: "pi-lens",
    });
}
//# sourceMappingURL=extension.js.map
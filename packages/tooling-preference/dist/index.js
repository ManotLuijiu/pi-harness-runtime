/**
 * The JS/TS tooling preference of a workspace.
 *
 * The harness offers the user to replace ESLint and Prettier with Biome.js
 * in a JavaScript/TypeScript workspace. The offer is a decision of its own:
 * it never pauses the work and never travels through the task-approval
 * path.
 */
export { detectPackageManager, detectToolingContext, evaluateBiomeProposalEligibility, } from "./detect.js";
export { buildToolingButtons, buildToolingImplementationPrompt, buildToolingProposalMessage, buildToolingRequestId, buildToolingUserKey, parseToolingTarget, TOOLING_ACTION, } from "./proposal.js";
export { harnessRuntimeDir, shouldAskAgain, ToolingPreferenceStore, toolingPreferenceKey, } from "./store.js";
export { ToolingRequestRegistry, } from "./registry.js";
//# sourceMappingURL=index.js.map
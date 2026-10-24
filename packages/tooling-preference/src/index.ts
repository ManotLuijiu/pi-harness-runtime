/**
 * The JS/TS tooling preference of a workspace.
 *
 * The harness offers the user to replace ESLint and Prettier with Biome.js
 * in a JavaScript/TypeScript workspace. The offer is a decision of its own:
 * it never pauses the work and never travels through the task-approval
 * path.
 */

export {
	detectPackageManager,
	detectToolingContext,
	evaluateBiomeProposalEligibility,
	type ProposalEligibility,
	type ToolingContext,
} from "./detect.js";

export {
	buildToolingButtons,
	buildToolingImplementationPrompt,
	buildToolingProposalMessage,
	buildToolingRequestId,
	buildToolingUserKey,
	parseToolingTarget,
	TOOLING_ACTION,
	type ToolingButton,
	type ToolingChoice,
	type ToolingPreference,
	type ToolingTarget,
} from "./proposal.js";

export {
	harnessRuntimeDir,
	shouldAskAgain,
	ToolingPreferenceStore,
	toolingPreferenceKey,
	type ToolingPreferenceRecord,
} from "./store.js";

export {
	ToolingRequestRegistry,
	type ToolingRequest,
	type ToolingResolution,
} from "./registry.js";

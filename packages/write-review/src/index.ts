/**
 * write-review - Two-agent code writing with review loop
 *
 * Integrates with pi-harness-runtime via:
 * - Smart trigger detection (prompt files in wiki/)
 * - System prompt injection for MiniMax writer agent
 * - Subagent integration for reviewer agent
 *
 * Directory structure: {project}/.write-review/
 */

export type {
	WriteReviewConfig,
	ReviewSession,
	ReviewStatus,
	ReviewResult,
	ReviewRound,
	ReviewGate,
	ReviewSuggestion,
	TriggerContext,
	ProjectContext,
} from "./types.js";

export { createReviewBlackboard, detectWriteReviewTrigger } from "./trigger.js";
export { injectWriterInstructions } from "./injection.js";
export { shouldPromptReview, passReviewGate, failReviewGate } from "./gate.js";
export { createReviewAgent, continueReviewLoop } from "./review.js";

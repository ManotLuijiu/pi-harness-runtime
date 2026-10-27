/**
 * Two-phase implementation and review workflow.
 *
 * Phase 1 finishes the implementation todos of a request. Phase 2 reviews the
 * diff of that request. A review signal that arrives during Phase 1 is
 * recorded and deferred, never executed between two implementation todos.
 */

export type {
	TwoPhasePhase,
	TodoKind,
	ReviewSignal,
	ReviewChunk,
	ReviewFinding,
	TwoPhaseState,
} from "./types.js";

export {
	IMPLEMENT_PREFIX,
	REVIEW_PREFIX,
	REVIEW_FIX_PREFIX,
	TEST_PREFIX,
	classifyTodo,
	isOpenTodo,
	openTodos,
	implementationTodos,
	completedImplementationTodos,
	reviewTodos,
	reviewFixTodos,
	testTodos,
	hasOpenImplementationWork,
	summarizeTodos,
	buildTodoSubject,
} from "./classify.js";
export type { TodoLike } from "./classify.js";

export {
	DEFAULT_REVIEW_TOOL_PATTERNS,
	DEFAULT_REVIEW_COMMAND_PATTERNS,
	parseExtraPatterns,
	isComprehensiveReviewTool,
	isReviewCommand,
	dispatchAgentName,
	detectReviewInvocation,
	explicitReviewRequest,
	extractFiles,
	signalKey,
	mergeSignals,
	summarizeSignals,
} from "./signals.js";
export type { ReviewInvocation, SignalSummary } from "./signals.js";

export {
	EXCLUDED_SCOPE_PREFIXES,
	DEFAULT_CHUNK_SIZE,
	isReviewablePath,
	isGitRepository,
	currentRevision,
	revisionExists,
	moduleKey,
	countModules,
	parseNumstat,
	collectScope,
	chunkScope,
	shouldChunkScope,
} from "./scope.js";
export type { ScopeMetrics, ScopeResult } from "./scope.js";

export {
	TWO_PHASE_STATE_DIR,
	createState,
	safeFileName,
	normalizeState,
	TwoPhaseStateStore,
	moveToPhase,
	recordSignal,
	transitionToReviewPending,
	startReview,
	markChunkDone,
	recordFinding,
	transitionToReviewFixes,
	transitionToTestPending,
	allChunksDone,
	markComplete,
	completeWithoutReview,
	hasQueuedReview,
} from "./state.js";

export {
	TWO_PHASE_CONTRACT,
	buildPhaseView,
	buildPhaseInstruction,
	buildReviewTodoSubject,
	buildReviewTodoDescription,
	buildChunkTodoSubject,
	buildChunkTodoDescription,
	isChunkTodo,
	syncChunkStatus,
	formatPhaseStatus,
	buildDeferralReason,
} from "./rules.js";
export type { PhaseView } from "./rules.js";

export {
	emptyValidationGateState,
	validationGateSatisfied,
	describeValidationGate,
} from "./validation.js";
export type {
	GateTodo,
	ValidationGateState,
	ValidationGateReader,
} from "./validation.js";

export {
	HARNESS_MESSAGE_MARKER,
	initTwoPhaseReview,
} from "./runtime.js";
export type {
	TwoPhaseExtensionApi,
	TwoPhaseExtensionContext,
	TwoPhaseRuntime,
	TwoPhaseRuntimeOptions,
	TodoReadResult,
	TodoReader,
} from "./runtime.js";

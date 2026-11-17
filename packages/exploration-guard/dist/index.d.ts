/**
 * The exploration guard.
 *
 * The guard observes what the agent reads while it investigates a request.
 * It keeps a bounded record of the investigation, it recognises a repeated
 * read of the same range, and it asks for a checkpoint when the exploration
 * passes the budget that the deployment chose.
 *
 * The guard never blocks the access to the source, never forces an edit and
 * never authorises anything: it says what it saw, and the agent decides.
 */
export type { ExplorationBudget, ExplorationCheckpoint, ExplorationFinding, ExplorationKey, ExplorationPhase, ExplorationState, ExplorationWarning, FileCoverage, InspectedRange, NarrowedHypothesis, ObservationKind, ObservationSource, RereadReason, SearchCoverage, } from "./types.js";
export { createState, emptyCheckpoint, ensureCoverage, ensureSearch, EXPLORATION_STATE_DIR, findCoverage, ExplorationStateStore, MAX_TRACKED_FILES, MAX_TRACKED_FINDINGS, MAX_TRACKED_HYPOTHESES, MAX_TRACKED_QUESTIONS, MAX_TRACKED_SEARCHES, normalizeState, pruneState, sanitizePath, sanitizeText, stateFileName, } from "./state.js";
export { classifyShellCommand, observeToolCall, type Observation, type ShellCommandReading, type ToolCallEnd, type ToolCallInput, } from "./observation.js";
export { assessExploration, CHECKPOINT_REQUEST_TEXT, classifyRepeat, DEFAULT_EXPLORATION_BUDGET, EXPLORATION_CONTINUATION_TEXT, hasSubstantiveProgress, type Intervention, type InterventionKind, isVisibleIntervention, rangeCovered, readsSinceNarrowing, repeatedPaths, } from "./budget.js";
export { applyCheckpoint, buildContinuationText, type CheckpointInput, type CompactCheckpoint, describeUnreadableCheckpoint, filesNeedingRevalidation, fromCompactCheckpoint, summarizeCheckpoint, toCompactCheckpoint, } from "./checkpoint.js";
export { explorationStatus, type ExplorationOutcome, type ExplorationStatus, formatExplorationStatus, } from "./status.js";
export { ExplorationTracker, type ExplorationTrackerOptions, type ObservationResult, } from "./tracker.js";
//# sourceMappingURL=index.d.ts.map
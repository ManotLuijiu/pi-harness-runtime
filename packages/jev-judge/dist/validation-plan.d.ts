/**
 * Validation Plan - staged (fast -> full) test tiers for a todo.
 *
 * The harness NEVER guesses a tier from a command string. A tier is declared
 * by the task author in the todo metadata, so the plan stays truthful and
 * reviewable:
 *
 * ```json
 * {
 *   "metadata": {
 *     "validationPlan": {
 *       "fast": { "command": "bun test tests/fast", "expectedDurationMs": 18000, "datasetSize": 100 },
 *       "full": { "command": "bun test tests/full", "expectedDurationMs": 2400000, "datasetSize": 10000 },
 *       "budgetMinutes": 90,
 *       "finalTierRequired": true
 *     }
 *   }
 * }
 * ```
 *
 * Every field is optional. A todo without a plan keeps the current behaviour
 * (no validation context is injected), so small tasks are unaffected.
 */
import type { TodoItem } from "./todo-provider.js";
/**
 * Which side of the ladder a tier sits on.
 *
 * - `fast`: representative, cheap, safe to run after every edit
 * - `full`: complete, expensive, run once as the final acceptance check
 */
export type ValidationTierKind = "fast" | "full";
/**
 * One declared validation tier.
 */
export interface ValidationTier {
    kind: ValidationTierKind;
    /** Exact command for this tier. Never rewritten by the harness. */
    command?: string;
    /** Human label, e.g. "fixture regression". */
    label?: string;
    /** Expected cost of the tier in milliseconds (measured or estimated). */
    expectedDurationMs?: number;
    /** Dataset size the tier exercises, when it is data-volume bound. */
    datasetSize?: number;
    /** Who runs the tier. */
    owner?: string;
    /** The criteria the tier has to meet. */
    passCriteria?: string[];
    /** What to do when the tier fails. */
    failureAction?: string;
    /**
     * Is this tier the representative pilot of the plan?
     *
     * The pilot keeps the shape of the data, not only its size.
     */
    representative?: boolean;
    /**
     * The tier this one scales up from.
     *
     * "fast" means the tier may only start when the fast tier passed.
     */
    scaleUpFrom?: ValidationTierKind;
}
/**
 * State of one tier for one todo item.
 */
export interface ValidationTierState {
    /** `not-run` when no run was recorded for this tier. */
    status: "passed" | "failed" | "timeout" | "error" | "skipped" | "not-run";
    /** Timestamp of the latest run. */
    at?: string;
    /** Duration of the latest run. */
    durationMs?: number;
    /** Command of the latest run. */
    command?: string;
}
/**
 * Aggregated validation state of a todo item.
 */
export interface ValidationState {
    /** True when the item declares a validation plan. */
    hasPlan: boolean;
    /** State of the cheap tier. */
    fast: ValidationTierState;
    /** State of the expensive tier. */
    full: ValidationTierState;
    /** True when the plan declares the full tier as the final acceptance check. */
    finalTierRequired: boolean;
    /**
     * True when the final tier is required but has not passed yet.
     *
     * A todo in this state must not be reported as complete.
     */
    finalTierPending: boolean;
    /** Soft time budget of the plan, in minutes. */
    budgetMinutes?: number;
    /** True when the plan requires a final tier but does not declare one. */
    planIncomplete: boolean;
}
/**
 * The full staged validation plan for a todo.
 */
export interface ValidationPlan {
    /** Cheap representative tier, used while the code is changing. */
    fast?: ValidationTier;
    /** Expensive complete tier, used once the implementation is stable. */
    full?: ValidationTier;
    /** Extra guidance for the agent (e.g. "fast tier must cover aggregation"). */
    notes?: string;
    /** Soft time budget for this todo, in minutes. */
    budgetMinutes?: number;
    /** When true, the todo must not be completed before the full tier passed. */
    finalTierRequired?: boolean;
}
/**
 * Parse a duration into milliseconds.
 *
 * Strings must carry a unit (`45s`, `40m`, `1h`, `1h30m`). A bare number is
 * milliseconds when it is at least 1000 and seconds below that, because a
 * bare "40" is ambiguous between milliseconds and minutes.
 */
export declare function parseDurationMs(value: unknown): number | undefined;
/**
 * Format a duration for a human-readable status line.
 */
export declare function formatDuration(ms: number): string;
/**
 * Parse one tier declaration.
 *
 * Accepts a plain command string (`"bun test fast"`) or an object with
 * `command`/`label`/`expectedDurationMs`/`datasetSize` fields.
 */
export declare function parseTier(value: unknown, kind: ValidationTierKind): ValidationTier | undefined;
/**
 * Read the validation plan of a todo.
 *
 * Returns `null` when the todo declares no plan: ordinary tasks must keep the
 * current behaviour.
 */
export declare function parseValidationPlan(item: TodoItem | null | undefined): ValidationPlan | null;
/**
 * Describe one tier in a single line: command, expected cost, dataset size.
 */
export declare function describeTier(tier: ValidationTier): string;
/**
 * Status of the soft time budget of a plan.
 */
export interface ValidationBudgetStatus {
    /** The budget in milliseconds, when the plan declares one. */
    budgetMs?: number;
    /** Time already spent on the item, when it is known. */
    elapsedMs?: number;
    /** Time left before the budget is exhausted. */
    remainingMs?: number;
    /** True when the budget is spent. */
    exhausted: boolean;
}
/**
 * Compute the budget status of a plan.
 *
 * There is no implicit budget: only a declared `budgetMinutes` arms it. An
 * invented budget could pause legitimate long work, so the harness never
 * guesses one.
 */
export declare function validationBudgetStatus(plan: ValidationPlan | null | undefined, elapsedMs?: number): ValidationBudgetStatus;
/**
 * Aggregate recorded runs into the validation state of an item.
 *
 * The runs are expected in chronological order; the latest run of a tier
 * defines its state.
 */
export declare function summarizeValidationState(plan: ValidationPlan | null | undefined, runs: {
    ts: string;
    tier: ValidationTierKind;
    status: string;
}[]): ValidationState;
/**
 * Render the validation context that is injected into a continuation message.
 *
 * The text is deliberately short: it is added to the steer payload that the
 * agent reads when the harness continues a todo on its own.
 */
export declare function formatValidationContext(plan: ValidationPlan, opts?: {
    elapsedMs?: number;
    state?: ValidationState;
}): string;
/**
 * Convenience wrapper: the validation context of a todo, or an empty string.
 */
export declare function buildValidationSteerSuffix(item: TodoItem | null | undefined, opts?: {
    elapsedMs?: number;
    state?: ValidationState;
}): string;
//# sourceMappingURL=validation-plan.d.ts.map
/**
 * Validation tie-breaker - a typed verdict about one todo item.
 *
 * The judge (Jev) and the harness both need the same question answered with
 * a value instead of prose: "may this item count as done?".
 *
 * The verdict is derived from the declared plan and the recorded runs:
 *
 * - `no-plan`             the item declares no validation plan
 * - `complete`            the final tier passed, or none was required
 * - `final-tier-pending`  the final tier is required and has not passed yet
 * - `final-tier-failed`   the final tier ran and did not pass
 * - `plan-incomplete`     the plan requires a final tier but declares none
 *
 * A `final-tier-pending` or `final-tier-failed` verdict means the item must
 * not be reported as complete.
 */
import type { TodoItem } from "./todo-provider.js";
import type { ValidationState } from "./validation-plan.js";
/**
 * Typed verdict about the validation state of one item.
 */
export type ValidationVerdict = "no-plan" | "complete" | "final-tier-pending" | "final-tier-failed" | "plan-incomplete";
/**
 * The verdict plus the context a caller needs to report it.
 */
export interface ValidationTieBreaker {
    verdict: ValidationVerdict;
    /** Human readable reason for the verdict. */
    reason: string;
    /** The item the verdict is about. */
    itemId?: number;
    /** Subject of the item. */
    subject?: string;
    /** Status of the final tier, when one ran. */
    tierStatus?: string;
    /** True when the item must not be reported as complete. */
    blocksCompletion: boolean;
}
/**
 * Derive the verdict from the validation state of an item.
 */
export declare function tieBreakValidation(item: TodoItem | null | undefined, state: ValidationState): ValidationTieBreaker;
/**
 * Format a verdict for a log line or a status line.
 */
export declare function formatTieBreaker(result: ValidationTieBreaker): string;
//# sourceMappingURL=validation-tie-breaker.d.ts.map
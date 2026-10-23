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
/**
 * Derive the verdict from the validation state of an item.
 */
export function tieBreakValidation(item, state) {
    const base = {
        itemId: item?.id,
        subject: item?.subject,
    };
    if (!state.hasPlan) {
        return {
            ...base,
            verdict: "no-plan",
            reason: "no validation plan declared",
            blocksCompletion: false,
        };
    }
    if (state.planIncomplete) {
        return {
            ...base,
            verdict: "plan-incomplete",
            reason: "the plan requires a final tier but declares none",
            blocksCompletion: true,
        };
    }
    if (!state.finalTierRequired) {
        return {
            ...base,
            verdict: "complete",
            reason: "no final tier required",
            blocksCompletion: false,
        };
    }
    if (state.full.status === "passed") {
        return {
            ...base,
            verdict: "complete",
            reason: "the final tier passed",
            tierStatus: state.full.status,
            blocksCompletion: false,
        };
    }
    if (state.full.status === "not-run") {
        return {
            ...base,
            verdict: "final-tier-pending",
            reason: "the final tier has not run yet",
            tierStatus: state.full.status,
            blocksCompletion: true,
        };
    }
    return {
        ...base,
        verdict: "final-tier-failed",
        reason: `the final tier did not pass (${state.full.status})`,
        tierStatus: state.full.status,
        blocksCompletion: true,
    };
}
/**
 * Format a verdict for a log line or a status line.
 */
export function formatTieBreaker(result) {
    const subject = result.subject ? `${result.subject}: ` : "";
    return `${subject}${result.verdict} (${result.reason})`;
}
//# sourceMappingURL=validation-tie-breaker.js.map
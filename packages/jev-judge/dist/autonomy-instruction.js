/**
 * The harness-authored instruction of an autonomous decision.
 *
 * The agent asked a concrete question and nobody answered. A decision that
 * only says "continue with the remaining tasks" does not answer that
 * question: the agent still does not know which option was taken. The
 * instruction therefore names the selected option, the scope and the
 * reasoning of the decision.
 *
 * Two rules are absolute:
 *
 * 1. The instruction never impersonates the user. It is labelled as the
 *    decision of Jev, and it says that a reply of the user still wins.
 * 2. The instruction is bounded by the deterministic policy. Only the
 *    outcome that the policy allowed reaches the agent.
 */
/**
 * The label of the instruction.
 *
 * It is the first thing the agent reads, so the origin of the decision is
 * never in doubt.
 */
export const AUTONOMY_INSTRUCTION_HEADER = "[Jev decision - not the user]";
/** The label of an outcome. */
function outcomeLabel(outcome) {
    const labels = {
        approve: "approved autonomously",
        proceed_with_caution: "approved autonomously with caution",
        reject: "rejected autonomously",
        wait: "kept waiting",
    };
    return labels[outcome];
}
/** The constraint that belongs to the outcome. */
function outcomeConstraint(outcome) {
    const constraints = {
        approve: "Continue with the remaining tasks under this decision.",
        proceed_with_caution: "Continue with the remaining tasks under this decision and report every significant step.",
        reject: "Do not carry out the proposed action.",
        wait: "Keep the question open.",
    };
    return constraints[outcome];
}
/** The constraint that belongs to the scope. */
function scopeConstraint(scope) {
    const constraints = {
        canary_first: "Scope: canary_first - validate the decision on a small canary (for example 100 records), verify the result, and report before the work scales up.",
        full_scope: "Scope: full_scope - the whole selected alternative.",
        none: "Scope: none - nothing is executed, the decision only names the preferred alternative.",
    };
    if (!scope)
        return undefined;
    return constraints[scope];
}
/**
 * Build the instruction the agent receives after the timeout.
 *
 * The instruction names the decision, the selected option, the scope and
 * the reasoning, and it never claims that the user answered.
 */
export function buildAutonomyInstruction(input) {
    const waited = typeof input.waitedMinutes === "number"
        ? ` after ${Math.round(input.waitedMinutes)} minute(s) of waiting`
        : "";
    const deadline = typeof input.deadlineMinutes === "number"
        ? ` (decision deadline: ${input.deadlineMinutes} minute(s))`
        : "";
    const lines = [
        `${AUTONOMY_INSTRUCTION_HEADER} The user did not answer${waited}, so Jev decided on its own${deadline}.`,
        `Decision: ${outcomeLabel(input.outcome)}.`,
    ];
    if (input.questionText) {
        lines.push(`Question: ${input.questionText}`);
    }
    if (input.selectedOption) {
        lines.push(`Selected option: ${input.selectedOption}`);
    }
    const scopeLine = scopeConstraint(input.scope);
    if (scopeLine) {
        lines.push(scopeLine);
    }
    if (input.reasoning) {
        lines.push(`Reasoning: ${input.reasoning}`);
    }
    if (input.riskLevel) {
        lines.push(`Risk level: ${input.riskLevel}`);
    }
    lines.push(outcomeConstraint(input.outcome));
    lines.push("This is Jev's decision, not an answer of the user. A reply of the user always wins.");
    return lines.join("\n");
}
//# sourceMappingURL=autonomy-instruction.js.map
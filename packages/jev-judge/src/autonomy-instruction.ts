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

import type { DecisionOutcome } from "./auto-continue.js";

/** The scope of an autonomous decision. */
export type { DecisionScope } from "./auto-continue.js";

/**
 * The label of the instruction.
 *
 * It is the first thing the agent reads, so the origin of the decision is
 * never in doubt.
 */
export const AUTONOMY_INSTRUCTION_HEADER = "[Jev decision - not the user]";

export interface AutonomyInstructionInput {
  /** The outcome the policy allowed. */
  outcome: DecisionOutcome;
  /** The question the agent asked. */
  questionText?: string;
  /** The option the decision selected. */
  selectedOption?: string;
  /** The scope the decision selected. */
  scope?: "full_scope" | "canary_first" | "none";
  /** The reasoning of the decision. */
  reasoning?: string;
  /** The risk level of the decision. */
  riskLevel?: string;
  /** How long the question waited. */
  waitedMinutes?: number;
  /** The deadline of the decision. */
  deadlineMinutes?: number;
}

/** The label of an outcome. */
function outcomeLabel(outcome: DecisionOutcome): string {
	const labels: Record<DecisionOutcome, string> = {
		approve: "approved autonomously",
		proceed_with_caution: "approved autonomously with caution",
		reject: "rejected autonomously",
		wait: "kept waiting",
	};
	return labels[outcome];
}

/** The constraint that belongs to the outcome. */
function outcomeConstraint(outcome: DecisionOutcome): string {
	const constraints: Record<DecisionOutcome, string> = {
		approve: "Continue with the remaining tasks under this decision.",
		proceed_with_caution:
			"Continue with the remaining tasks under this decision and report every significant step.",
		reject: "Do not carry out the proposed action.",
		wait: "Keep the question open.",
	};
	return constraints[outcome];
}

/** The constraint that belongs to the scope. */
function scopeConstraint(
	scope: AutonomyInstructionInput["scope"],
): string | undefined {
	const constraints: Record<
		NonNullable<AutonomyInstructionInput["scope"]>,
		string
	> = {
		canary_first:
			"Scope: canary_first - validate the decision on a small canary (for example 100 records), verify the result, and report before the work scales up.",
		full_scope: "Scope: full_scope - the whole selected alternative.",
		none: "Scope: none - nothing is executed, the decision only names the preferred alternative.",
	};
	if (!scope) return undefined;
	return constraints[scope];
}

/**
 * Build the instruction the agent receives after the timeout.
 *
 * The instruction names the decision, the selected option, the scope and
 * the reasoning, and it never claims that the user answered.
 */
export function buildAutonomyInstruction(
	input: AutonomyInstructionInput,
): string {
	const waited =
		typeof input.waitedMinutes === "number"
			? ` after ${Math.round(input.waitedMinutes)} minute(s) of waiting`
			: "";
	const deadline =
		typeof input.deadlineMinutes === "number"
			? ` (decision deadline: ${input.deadlineMinutes} minute(s))`
			: "";

	const lines: string[] = [
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
	lines.push(
		"This is Jev's decision, not an answer of the user. A reply of the user always wins.",
	);

	return lines.join("\n");
}

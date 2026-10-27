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
export declare const AUTONOMY_INSTRUCTION_HEADER = "[Jev decision - not the user]";
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
/**
 * Build the instruction the agent receives after the timeout.
 *
 * The instruction names the decision, the selected option, the scope and
 * the reasoning, and it never claims that the user answered.
 */
export declare function buildAutonomyInstruction(input: AutonomyInstructionInput): string;
//# sourceMappingURL=autonomy-instruction.d.ts.map
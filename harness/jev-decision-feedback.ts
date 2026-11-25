import type { WaitEvaluation } from "../packages/jev-judge/dist/wait-lifecycle.js";

/** Keep provider text on one bounded terminal line. */
function statusDetail(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

/** A failed evaluation is never presented as a decision to wait or reject. */
export function jevDecisionStatus(evaluation: WaitEvaluation): string {
	const label = evaluation.error
		? "[WARN] Jev: evaluation failed"
		: evaluation.outcome === "wait"
			? "[WAIT] Jev: waiting for your approval"
			: evaluation.outcome === "reject"
				? "[STOP] Jev: NO - paused"
				: evaluation.outcome === "proceed_with_caution"
					? "[RUN] Jev: YES - continuing with caution"
					: "[RUN] Jev: YES - continuing";
	const detail = statusDetail(evaluation.error?.message || evaluation.reasoning || evaluation.policyApplied || "");
	return detail ? `${label} | ${detail}` : label;
}

export interface HumanRequiredQuestion {
	requestId: string;
	text: string;
	kind?: string;
	alternatives?: string[];
}

/** Send a follow-up for the existing question; do not open a second approval. */
export async function notifyJevHumanRequired(options: {
	question: HumanRequiredQuestion;
	evaluation: WaitEvaluation;
	isCurrent(): boolean;
	deliver(question: HumanRequiredQuestion, text: string): Promise<{
		success: boolean; channel: string; error?: string;
	}[]>;
	onFailure(message: string): void;
}): Promise<void> {
	if (options.evaluation.error || options.evaluation.outcome !== "wait" || !options.isCurrent()) return;
	const lines = ["Jev: waiting for your approval", "", options.question.text];
	if (options.question.alternatives && options.question.alternatives.length >= 2) {
		lines.push("", "Options:", ...options.question.alternatives.map((text, index) => `${index + 1}. ${text}`));
	}
	lines.push("", `Reason: ${options.evaluation.reasoning || options.evaluation.policyApplied || "A human answer is required."}`,
		"The work is paused until you answer this question.");
	let failure: string | undefined;
	try {
		const results = await options.deliver(options.question, lines.join("\n"));
		const failed = results.filter((result) => !result.success);
		if (results.length === 0) failure = "no Telegram/LINE approval channel is available";
		else if (failed.length > 0) failure = `approval notification failed: ${failed.map((result) => result.channel).join(", ")}`;
	} catch {
		failure = "the approval notification could not be sent";
	}
	// A late delivery failure must not overwrite a reply or a newer question.
	if (failure && options.isCurrent()) options.onFailure(failure);
}

import type { ContextUsage } from "@earendil-works/pi-coding-agent";

export const PROACTIVE_COMPACT_THRESHOLD = 0.9;
export const PROACTIVE_COMPACT_COOLDOWN_MS = 10 * 60 * 1000;
export const OUTPUT_LIMIT_AUTO_RESUME_LIMIT = 3;
export const OUTPUT_LIMIT_RESUME_PROMPT =
	"Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought if the cut happened there. Break remaining work into smaller pieces.";

export function shouldTriggerProactiveCompact(
	usage: ContextUsage | undefined,
	options?: { threshold?: number },
): boolean {
	const threshold = options?.threshold ?? PROACTIVE_COMPACT_THRESHOLD;
	if (!usage || usage.percent === null) {
		return false;
	}
	return usage.percent >= threshold;
}

export type AssistantStopLike = {
	role?: string;
	stopReason?: unknown;
	errorMessage?: unknown;
};

export function isOutputLimitAssistantMessage(
	message: AssistantStopLike,
): boolean {
	if (message.role !== "assistant") {
		return false;
	}

	if (
		message.stopReason === "length" ||
		message.stopReason === "max_output_tokens" ||
		message.stopReason === "max_tokens"
	) {
		return true;
	}

	return (
		typeof message.errorMessage === "string" &&
		/reached the maximum output token limit|maximum output token limit|output token limit/i.test(
			message.errorMessage,
		)
	);
}

export function shouldQueueOutputLimitResume(
	message: AssistantStopLike,
	resumeAttempts: number,
	hasPendingMessages: boolean,
	options?: { maxAttempts?: number },
): boolean {
	const maxAttempts = options?.maxAttempts ?? OUTPUT_LIMIT_AUTO_RESUME_LIMIT;
	return (
		isOutputLimitAssistantMessage(message) &&
		resumeAttempts < maxAttempts &&
		!hasPendingMessages
	);
}

export function shouldQueuePostCompactionResume(
	event: { willRetry?: boolean },
	hasPendingMessages: boolean,
): boolean {
	return event.willRetry !== true && !hasPendingMessages;
}

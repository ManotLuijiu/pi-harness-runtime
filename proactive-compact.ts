import type { ContextUsage } from "@earendil-works/pi-coding-agent";

export const PROACTIVE_COMPACT_THRESHOLD = 0.9;
export const PROACTIVE_COMPACT_COOLDOWN_MS = 10 * 60 * 1000;

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

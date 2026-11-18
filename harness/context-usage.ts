/**
 * The fill of the context window, in one unit.
 *
 * The installed pi computes `percent = (tokens / contextWindow) * 100`:
 * the number of the usage is a percentage and not a fraction. A caller
 * that compares it with 0.9 fires at one percent, and a caller that
 * compares it with 90 never fires.
 *
 * The ratio of the tokens is the source of truth, because it is the
 * measurement and not a derived number of a provider. A usage without
 * tokens stays unknown: an unknown fill is not a full window.
 */

/**
 * The part of the usage of the context that the harness reads.
 */
export interface ContextUsageLike {
	/** The tokens of the context. */
	tokens?: number | null;
	/** The size of the context window. */
	contextWindow?: number | null;
	/** The percentage of the window, as the pi reports it. */
	percent?: number | null;
}

/**
 * The fill of the context window in percent, or undefined when it is
 * unknown.
 */
export function contextFillPercent(
	usage: ContextUsageLike | undefined | null,
): number | undefined {
	if (!usage) return undefined;
	const tokens = usage.tokens;
	const window = usage.contextWindow;
	if (
		typeof tokens === "number" &&
		Number.isFinite(tokens) &&
		typeof window === "number" &&
		Number.isFinite(window) &&
		window > 0
	) {
		return (tokens / window) * 100;
	}
	const percent = usage.percent;
	if (typeof percent === "number" && Number.isFinite(percent)) return percent;
	return undefined;
}

/**
 * Is the context window at least this full?
 *
 * An unknown fill answers false: the window is not known to be full,
 * and a compaction that nobody measured is a compaction without a
 * reason.
 */
export function contextAtLeast(
	usage: ContextUsageLike | undefined | null,
	percent: number,
): boolean {
	const fill = contextFillPercent(usage);
	if (fill === undefined) return false;
	return fill >= percent;
}

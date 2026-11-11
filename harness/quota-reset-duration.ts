/**
 * The duration of a quota reset, as the console of a provider writes it.
 *
 * The console of MiniMax shows the remaining time of a window as text
 * ("Resets in 1 hr 42 min"). The mirror of the harness needs an absolute
 * moment, because the recovery compares it with the clock when it decides
 * when to continue.
 *
 * The conversion is anchored at the moment of the capture: the text
 * describes the moment of the capture, so the epoch of the reset is the
 * capture plus the duration. A text that is not a duration - a date, an
 * empty field, a number without a unit - proves nothing and yields no
 * epoch.
 */

/** The milliseconds of every unit the console writes. */
const UNIT_MS: Record<string, number> = {
	s: 1000,
	sec: 1000,
	secs: 1000,
	second: 1000,
	seconds: 1000,
	m: 60_000,
	min: 60_000,
	mins: 60_000,
	minute: 60_000,
	minutes: 60_000,
	h: 3_600_000,
	hr: 3_600_000,
	hrs: 3_600_000,
	hour: 3_600_000,
	hours: 3_600_000,
	d: 86_400_000,
	day: 86_400_000,
	days: 86_400_000,
	w: 604_800_000,
	week: 604_800_000,
	weeks: 604_800_000,
};

const DURATION_PATTERN =
	/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/gi;

/**
 * The duration of a reset text, in milliseconds.
 *
 * The text may carry a prefix ("Resets in ...") and several units
 * ("4 days 20 hr 42 min"). The units are summed. A text without a
 * duration yields nothing.
 */
export function parseResetDurationMs(
	text: string | undefined | null,
): number | undefined {
	if (typeof text !== "string") return undefined;
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	let total = 0;
	let found = false;
	for (const match of trimmed.matchAll(DURATION_PATTERN)) {
		const amount = Number.parseFloat(match[1]);
		const unit = match[2].toLowerCase();
		const unitMs = UNIT_MS[unit];
		if (!Number.isFinite(amount) || unitMs === undefined) continue;
		total += amount * unitMs;
		found = true;
	}
	return found ? Math.round(total) : undefined;
}

/**
 * The absolute epoch of a reset, read from the text of the console.
 *
 * The observation is the anchor: the text describes the state of the
 * window at the moment of the capture.
 */
export function resetEpochFromDuration(
	text: string | undefined | null,
	observedAtMs: number | undefined | null,
): number | undefined {
	if (typeof observedAtMs !== "number" || !Number.isFinite(observedAtMs)) {
		return undefined;
	}
	const duration = parseResetDurationMs(text);
	if (duration === undefined) return undefined;
	const epoch = observedAtMs + duration;
	return Number.isFinite(epoch) ? epoch : undefined;
}

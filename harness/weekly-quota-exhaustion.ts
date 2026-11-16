/**
 * The exhaustion of the weekly allowance of a provider.
 *
 * The weekly window is not the five-hour window: it lasts days, and no
 * bounded cycle of retries reaches its end. A weekly allowance that is
 * empty therefore blocks the account until the week resets, and that is a
 * decision of the human: the harness may count down to the reset, or the
 * human may deal with the account itself. Until the human chooses, the
 * work stays paused.
 *
 * The evidence is the mirror of the harness, and it has to be fresh: a row
 * of the mirror that is hours old describes a week that may already have
 * been paid for. The selector therefore reads the row that the harness
 * already has - it never scrapes again - and it refuses a row that is not
 * fresh, not for this provider, or not complete.
 *
 * The module is pure: it decides, it does not observe, notify or
 * schedule.
 */

import type { ProviderMirrorRecord } from "../mirror.ts";
import type { ProviderFailure } from "./provider-failure.ts";
import {
	MAX_RESET_EVIDENCE_AGE_MS,
	normalizeProviderIdentity,
} from "./provider-recovery.ts";
import {
	quotaWindowState,
	remainingPctFromUsedPct,
} from "./quota-threshold.ts";

/**
 * The evidence of an empty weekly allowance.
 */
export interface WeeklyQuotaExhaustion {
	/** The provider whose weekly allowance is empty. */
	provider: string;
	/** The absolute epoch of the weekly reset. */
	resetAt: number;
	/** When the evidence was observed. */
	observedAt: number;
	/** The remaining percentage of the weekly window (zero when it is empty). */
	remainingPct: number;
	/** Where the evidence came from. */
	source: string;
}

/**
 * The names the providers are known by in a message of the harness.
 *
 * The provider writes its own name ("MiniMax"), and the id of the mirror
 * is lower case. A message about the account of the user should carry the
 * name the user knows.
 */
const DISPLAY_NAMES: Record<string, string> = {
	minimax: "MiniMax",
	glm: "GLM",
	openai: "OpenAI",
	anthropic: "Anthropic",
	openrouter: "OpenRouter",
};

/**
 * The name of a provider for a message of the harness.
 */
export function providerDisplayName(provider: string): string {
	const key = normalizeProviderIdentity(provider);
	return DISPLAY_NAMES[key] ?? provider;
}

/**
 * Is the weekly allowance of the provider empty?
 *
 * The decision needs three facts, and every one of them has to be there:
 *
 * - the failure is a failure of the quota (an exhausted plan or a rate
 *   limit). A rejected credential or an overload says nothing about the
 *   weekly allowance,
 * - the row of the mirror is for this provider and is fresh, and
 * - the weekly window of that row is empty and has a reset in the future.
 *
 * A weekly window that is empty but has no usable reset yields nothing:
 * without a moment to wait for, the harness cannot offer a countdown, and
 * the ordinary recovery of the quota keeps its own rules.
 */
export function weeklyQuotaExhausted(input: {
	/** The classified failure of the provider. */
	failure: ProviderFailure;
	/** The provider that rejected the request. */
	provider: string;
	/** The row of the mirror, when there is one. */
	mirror: ProviderMirrorRecord | null | undefined;
	/** The clock of the decision. */
	now: number;
}): WeeklyQuotaExhaustion | undefined {
	const { failure, provider, mirror, now } = input;
	if (failure.kind !== "usage-exhausted" && failure.kind !== "rate-limit") {
		return undefined;
	}
	if (!mirror) return undefined;
	if (
		normalizeProviderIdentity(mirror.provider) !==
		normalizeProviderIdentity(provider)
	) {
		return undefined;
	}
	const observedAt = Date.parse(mirror.synced_at);
	if (
		!Number.isFinite(observedAt) ||
		observedAt > now ||
		now - observedAt > MAX_RESET_EVIDENCE_AGE_MS
	) {
		return undefined;
	}
	if (quotaWindowState(mirror.weekly_used_pct) !== "exhausted") {
		return undefined;
	}
	const resetAt = mirror.weekly_resets_at_epoch;
	if (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt <= now) {
		return undefined;
	}
	return {
		provider: normalizeProviderIdentity(provider),
		resetAt,
		observedAt,
		remainingPct: remainingPctFromUsedPct(mirror.weekly_used_pct as number),
		source: mirror.source,
	};
}

/**
 * The duration until a reset, in the words of the console.
 *
 * The console of a provider writes the remaining time of a window as
 * "2 days 7 hours 58 minutes", and the harness writes it the same way.
 * The unit that is missing is left out, and a duration below a minute is
 * written in seconds.
 */
export function formatResetDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms));
	const days = Math.floor(total / 86_400_000);
	const hours = Math.floor((total % 86_400_000) / 3_600_000);
	const minutes = Math.floor((total % 3_600_000) / 60_000);
	const seconds = Math.floor((total % 60_000) / 1000);
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
	if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
	if (minutes > 0) {
		parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
	}
	if (parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
	return parts.join(" ");
}

/**
 * The message of the exhaustion of the weekly allowance.
 *
 * The message names the provider, the remaining time of the week and the
 * state of the work. It travels in full: a truncated message is not a
 * message the user can decide about.
 */
export function weeklyExhaustionMessage(input: {
	/** The provider whose weekly allowance is empty. */
	provider: string;
	/** The absolute epoch of the weekly reset. */
	resetAt: number;
	/** The clock of the message. */
	now: number;
}): string {
	const { provider, resetAt, now } = input;
	return `${providerDisplayName(provider)} weekly quota exhausted. Resets in ${formatResetDuration(resetAt - now)}. Work is paused.`;
}

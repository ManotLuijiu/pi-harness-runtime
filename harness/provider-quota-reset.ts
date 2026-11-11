import type { ProviderMirrorRecord } from "../mirror.ts";
import type { ProviderFailure } from "./provider-failure.ts";
import {
	MAX_RESET_EVIDENCE_AGE_MS,
	normalizeProviderIdentity,
	type RecoveryResetEvidence,
} from "./provider-recovery.ts";
import { decideQuotaReset, quotaWindowState } from "./quota-threshold.ts";

/** Give the quota service time to settle before probing it again. */
export const QUOTA_RESET_BUFFER_MS = 10 * 60_000;

/** The name of a quota window of the provider. */
type QuotaWindowName = "h5" | "weekly";

/**
 * A failed request plus fresh quota can identify a reset even when the
 * provider's generic error does not name its window.
 *
 * A window that is empty decides on its own: the account is blocked until
 * it resets, and the bounded cycle cannot change that. A window that is
 * nearly empty - below ten percent of the allowance - decides as well,
 * when its reset is more than an hour away. A reset that arrives sooner is
 * reached by the bounded cycle, and the cycle keeps the failure.
 *
 * The percentages of the mirror are the used percentages; the policy is
 * stated in the remaining percentage, and the conversion is in
 * `quota-threshold.ts`.
 *
 * The selector reads the capture that the harness already has. It never
 * scrapes again and never parses the text of the console: a capture that is
 * not fresh, not complete or not for this provider proves nothing.
 */
export function confirmedQuotaReset(
	failure: ProviderFailure,
	provider: string,
	mirror: ProviderMirrorRecord | null | undefined,
	now: number,
): RecoveryResetEvidence | undefined {
	if (failure.kind !== "usage-exhausted" && failure.kind !== "rate-limit") {
		return undefined;
	}
	if (
		!mirror ||
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
	const windows: {
		window: QuotaWindowName;
		used: number | undefined;
		resetAt: number | undefined;
	}[] = [
		{
			window: "h5",
			used: mirror.h5_used_pct,
			resetAt: mirror.h5_resets_at_epoch,
		},
		{
			window: "weekly",
			used: mirror.weekly_used_pct,
			resetAt: mirror.weekly_resets_at_epoch,
		},
	];
	// An empty window blocks the account until it resets.
	const exhausted = windows.filter(
		({ used }) => quotaWindowState(used) === "exhausted",
	);
	if (exhausted.length > 0) {
		// If an exhausted window has no usable reset, another window cannot
		// establish when the account becomes usable. Keep bounded recovery.
		let latest: { window: QuotaWindowName; resetAt: number } | undefined;
		for (const { window, resetAt } of exhausted) {
			if (
				typeof resetAt !== "number" ||
				!Number.isFinite(resetAt) ||
				resetAt <= now
			) {
				return undefined;
			}
			if (!latest || resetAt > latest.resetAt) latest = { window, resetAt };
		}
		if (!latest) return undefined;
		return {
			provider: normalizeProviderIdentity(provider),
			window: latest.window,
			resetAt: latest.resetAt,
			observedAt,
			source: mirror.source,
		};
	}

	// No window is empty. A window that is nearly empty decides, when its
	// reset is far enough away: a reset that arrives within the hour is
	// reached by the bounded cycle of the failure.
	const low = windows.filter(({ used }) => quotaWindowState(used) === "low");
	let latestLow: { window: QuotaWindowName; resetAt: number } | undefined;
	for (const { window, used, resetAt } of low) {
		if (decideQuotaReset({ usedPct: used, resetAt, now }) !== "reset") {
			continue;
		}
		if (typeof resetAt !== "number" || !Number.isFinite(resetAt)) continue;
		if (!latestLow || resetAt > latestLow.resetAt) {
			latestLow = { window, resetAt };
		}
	}
	if (!latestLow) return undefined;

	return {
		provider: normalizeProviderIdentity(provider),
		window: latestLow.window,
		resetAt: latestLow.resetAt,
		observedAt,
		source: mirror.source,
	};
}

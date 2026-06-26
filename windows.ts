/**
 * WindowAggregator — compute rolling 5h + weekly windows from local records.
 *
 * We do NOT need provider-reported reset times — we can DERIVE them from our
 * own data: oldest record in window + window duration = when that record
 * will fall out of the window = the "reset" moment for OUR local usage.
 *
 * For provider-mirror reset times, we just read them from MirrorStore.
 */

import type { UsageRecord } from "./tracker.ts";

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface WindowStats {
	tokens: number;
	requests: number;
	cost: number;
	oldest_ts: number | null;   // oldest record in window (for reset calculation)
}

export interface AggregatedWindows {
	five_h: WindowStats;
	weekly: WindowStats;
	today: WindowStats;         // since midnight UTC (computed too — handy)
	lifetime: WindowStats;
}

function emptyWindow(): WindowStats {
	return { tokens: 0, requests: 0, cost: 0, oldest_ts: null };
}

function rollUp(records: UsageRecord[]): WindowStats {
	const stats = emptyWindow();
	for (const r of records) {
		const tokens = r.input + r.output + r.cache_read + r.cache_write;
		stats.tokens += tokens;
		stats.requests += 1;
		stats.cost += r.cost;
		if (stats.oldest_ts === null || r.ts < stats.oldest_ts) {
			stats.oldest_ts = r.ts;
		}
	}
	return stats;
}

/** Compute reset time for a rolling window from its oldest record. */
export function computeLocalResetTime(stats: WindowStats, windowMs: number): number | null {
	if (stats.oldest_ts === null) return null;
	return stats.oldest_ts + windowMs;
}

/** Filter records within a rolling window. */
function withinWindow(records: UsageRecord[], nowMs: number, windowMs: number): UsageRecord[] {
	const cutoff = nowMs - windowMs;
	return records.filter((r) => r.ts >= cutoff);
}

/** UTC midnight (ms) of the day containing `nowMs`. */
function utcMidnight(nowMs: number): number {
	const d = new Date(nowMs);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Monday 00:00 UTC of the week containing `nowMs`. */
function weeklyCutoff(nowMs: number): number {
	const d = new Date(nowMs);
	const day = d.getUTCDay();           // 0=Sun..6=Sat
	const diff = (day + 6) % 7;          // days since Monday
	const mondayMidnight = utcMidnight(nowMs) - diff * 86400 * 1000;
	return mondayMidnight;
}

/** Main entry: aggregate all windows from raw records. */
export function aggregateWindows(records: UsageRecord[], nowMs: number = Date.now()): AggregatedWindows {
	const five_h = rollUp(withinWindow(records, nowMs, FIVE_HOURS_MS));
	const weekly = rollUp(withinWindow(records, nowMs, SEVEN_DAYS_MS));
	const today = rollUp(records.filter((r) => r.ts >= utcMidnight(nowMs)));
	const lifetime = rollUp(records);
	return { five_h, weekly, today, lifetime };
}

/**
 * Compute burn rate (% per day) from the weekly mirror.
 * mirror.weekly_used_pct used, time since weekly reset = nowMs - weekly_resets_at.
 */
export function computeBurnRate(
	mirrorWeeklyUsedPct: number,
	weeklyResetsAtMs: number,
	nowMs: number,
): { pct_per_day: number; days_until_full: number | null } {
	const elapsedMs = nowMs - weeklyResetsAtMs;
	if (elapsedMs <= 0) {
		return { pct_per_day: 0, days_until_full: null };
	}
	const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
	const pctPerDay = mirrorWeeklyUsedPct / elapsedDays;
	const remainingPct = 100 - mirrorWeeklyUsedPct;
	if (pctPerDay <= 0) {
		return { pct_per_day: 0, days_until_full: null };
	}
	const daysUntilFull = remainingPct / pctPerDay;
	return { pct_per_day: pctPerDay, days_until_full: daysUntilFull };
}

/**
 * Compute the divergence between local-tracked usage and provider mirror.
 * Returns the difference in percentage points (positive = local > mirror).
 *
 * This is a rough check: if local tracking shows 5% used but provider
 * mirror shows 30%, you know other clients (or pre-existing quota) are
 * using the same provider account.
 */
export function computeLocalVsMirrorDelta(
	localFiveHPct: number,
	mirrorFiveHPct: number | undefined,
): number | null {
	if (mirrorFiveHPct === undefined) return null;
	return localFiveHPct - mirrorFiveHPct;
}
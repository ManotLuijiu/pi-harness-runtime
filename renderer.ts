/**
 * StatusRenderer — Codex-style output formatting.
 *
 * Produces the same visual style as Codex's `/status`:
 *   5h limit:     [████████░░░░░░░░░░░░] 18% left (resets in 4h 56m)
 *   Weekly limit: [████████████████░░░░] 81% left (resets in 2d 13h)
 *
 * We render with plain text (no TUI dependency) so it's testable with
 * node --test and works in `ctx.ui.notify()`.
 */

import {
	formatDuration,
	formatRelative,
	formatTokens,
	formatUsd,
} from "./cli.ts";
import type { AggregatedWindows } from "./windows.ts";
import {
	FIVE_HOURS_MS,
	SEVEN_DAYS_MS,
	computeLocalResetTime,
} from "./windows.ts";
import type { MirrorRecord } from "./mirror.ts";
import type { MirrorStore } from "./mirror.ts";

const BAR_WIDTH = 20;
const FILLED = "█";
const EMPTY = "░";

export interface RenderInput {
	model: string | null;
	cwd: string;
	local: AggregatedWindows;
	mirror: MirrorRecord | null;
	mirrorStore: MirrorStore; // for freshness check
	nowMs: number;
	// Optional: local usage limit configuration (for "X% of limit used")
	localFiveHLimitTokens?: number;
	localWeeklyLimitTokens?: number;
}

export function renderProgressBar(
	pct: number,
	width: number = BAR_WIDTH,
): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filledCount = Math.round((clamped / 100) * width);
	const emptyCount = width - filledCount;
	return "[" + FILLED.repeat(filledCount) + EMPTY.repeat(emptyCount) + "]";
}

/** Render the "18% left" style label (what's REMAINING, like Codex). */
function renderLeftLabel(pct: number): string {
	const left = Math.max(0, Math.min(100, 100 - pct));
	return `${left.toFixed(0)}% left`;
}

/** Render the full status block. */
export function renderStatus(input: RenderInput): string {
	const lines: string[] = [];
	const divider = "─".repeat(64);

	// ─── Header ──────────────────────────────────────────────────────────
	lines.push("Codex-style usage status for pi");
	lines.push(divider);
	lines.push(` Model:        ${input.model ?? "unknown"}`);
	lines.push(` Directory:    ${input.cwd}`);
	lines.push("");

	// ─── Local tracking ─────────────────────────────────────────────────
	lines.push(" ① LOCAL TRACKED (ground truth — we count this)");
	lines.push(
		`    This session:   ${formatUsd(input.local.lifetime.cost)} · ${formatTokens(input.local.lifetime.tokens)} tokens · ${input.local.lifetime.requests} requests`,
	);
	lines.push(
		`    This 5h:        ${formatTokens(input.local.five_h.tokens)} tokens · ${input.local.five_h.requests} requests · ${formatUsd(input.local.five_h.cost)}`,
	);
	lines.push(
		`    This week:      ${formatTokens(input.local.weekly.tokens)} tokens · ${input.local.weekly.requests} requests · ${formatUsd(input.local.weekly.cost)}`,
	);
	lines.push(
		`    Lifetime:       ${input.local.lifetime.requests} requests · ${formatUsd(input.local.lifetime.cost)}`,
	);
	lines.push("");

	// ─── Provider mirror ─────────────────────────────────────────────────
	if (input.mirror) {
		const fresh = input.mirrorStore.freshness(input.mirror, input.nowMs);
		const freshnessLabel =
			fresh === "fresh"
				? "fresh"
				: fresh === "stale"
					? "stale"
					: fresh === "expired"
						? "EXPIRED"
						: "missing";
		lines.push(` ② PROVIDER MIRROR (auto-fetched from MiniMax console)`);
		lines.push(
			`    Last sync:      ${formatRelative(input.mirror.synced_at, input.nowMs)} [${freshnessLabel}]`,
		);
		lines.push(`    Provider:       ${input.mirror.provider ?? "unknown"}`);

		// 5h line
		if (input.mirror.h5_used_pct !== undefined) {
			const pct = input.mirror.h5_used_pct;
			const resetStr = input.mirror.h5_resets_at
				? formatDuration(Date.parse(input.mirror.h5_resets_at) - input.nowMs)
				: "unknown";
			lines.push(
				`    5h limit:       ${renderProgressBar(pct)} ${renderLeftLabel(pct)} (resets in ${resetStr})`,
			);
		} else {
			lines.push(`    5h limit:       (waiting for next auto refresh)`);
		}

		// Weekly line
		if (input.mirror.weekly_used_pct !== undefined) {
			const pct = input.mirror.weekly_used_pct;
			const resetStr = input.mirror.weekly_resets_at
				? formatDuration(
						Date.parse(input.mirror.weekly_resets_at) - input.nowMs,
					)
				: "unknown";
			lines.push(
				`    Weekly limit:   ${renderProgressBar(pct)} ${renderLeftLabel(pct)} (resets in ${resetStr})`,
			);
		} else {
			lines.push(`    Weekly limit:   (waiting for next auto refresh)`);
		}
		lines.push("");
	} else {
		lines.push(` ② PROVIDER MIRROR`);
		lines.push(
			`    Not synced yet. Auto refresh will populate data from MiniMax console.`,
		);
		lines.push("");
	}

	// ─── Local reset times (derived) ────────────────────────────────────
	lines.push(" ③ LOCAL RESET TIMES (derived from your data)");
	const local5hReset = computeLocalResetTime(input.local.five_h, FIVE_HOURS_MS);
	const localWeekReset = computeLocalResetTime(
		input.local.weekly,
		SEVEN_DAYS_MS,
	);
	if (local5hReset) {
		const remaining = local5hReset - input.nowMs;
		lines.push(
			`    Local 5h reset:    in ${formatDuration(remaining)} (oldest request falls out of window)`,
		);
	} else {
		lines.push(`    Local 5h reset:    no requests in last 5 hours`);
	}
	if (localWeekReset) {
		const remaining = localWeekReset - input.nowMs;
		lines.push(
			`    Local week reset:  in ${formatDuration(remaining)} (oldest request falls out of window)`,
		);
	} else {
		lines.push(`    Local week reset:  no requests in last 7 days`);
	}

	// ─── Local-vs-mirror divergence ─────────────────────────────────────
	if (input.mirror?.h5_used_pct !== undefined) {
		const localPct = input.localFiveHLimitTokens
			? (input.local.five_h.tokens / input.localFiveHLimitTokens) * 100
			: 0;
		const delta = localPct - input.mirror.h5_used_pct;
		const deltaStr =
			delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
		const warning = Math.abs(delta) > 5 ? " ⚠️  divergence > 5%" : "";
		lines.push(`    Local-vs-mirror:  ${deltaStr}${warning}`);
	}

	// ─── Burn rate ──────────────────────────────────────────────────────
	if (
		input.mirror?.weekly_used_pct !== undefined &&
		input.mirror.weekly_resets_at
	) {
		const resetMs = Date.parse(input.mirror.weekly_resets_at);
		const elapsedMs = input.nowMs - resetMs;
		const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
		if (elapsedDays > 0) {
			const pctPerDay = input.mirror.weekly_used_pct / elapsedDays;
			const remaining = 100 - input.mirror.weekly_used_pct;
			const daysLeft = pctPerDay > 0 ? remaining / pctPerDay : Infinity;
			const daysLeftStr =
				daysLeft === Infinity ? "∞" : `${daysLeft.toFixed(1)} d`;
			lines.push(
				`    Burn rate:        ${pctPerDay.toFixed(1)}% / day → 100% in ${daysLeftStr}`,
			);
		}
	}

	lines.push(divider);
	lines.push(
		` Data dir:    ${process.env.PI_USAGE_DIR ?? "~/.pi/usage-status"}`,
	);
	lines.push(` Local time:  ${new Date(input.nowMs).toISOString()}`);
	lines.push("");
	lines.push(" Run `/usage refresh` to fetch the latest provider mirror now.");

	return lines.join("\n");
}

import type { MirrorRecord } from "./mirror.ts";
import { formatQuotaStatus } from "./harness/e2e/quota-status.js";
import {
	parseContextWindowStatusLine,
	parseQuotaUsageStatusLine,
	type ParsedContextWindowUsage,
	type ParsedQuotaUsageData,
} from "./status-parsers.ts";

export type ParsedFooterStatusValue =
	| { kind: "quota"; value: ParsedQuotaUsageData }
	| { kind: "context-window"; value: ParsedContextWindowUsage }
	| { kind: "today"; value: { tokens: number; cost: number } }
	| { kind: "unknown"; value: null };

export function parseFooterStatusValue(value: string): ParsedFooterStatusValue {
	const quota = parseQuotaUsageStatusLine(value);
	if (quota) {
		return { kind: "quota", value: quota };
	}

	const contextWindow = parseContextWindowStatusLine(value);
	if (contextWindow) {
		return { kind: "context-window", value: contextWindow };
	}

	const todayMatch = value.match(/^today:\s*([\d,.]+)k tok\s*·\s*\$([\d,.]+)/i);
	if (todayMatch) {
		const tokens = Number.parseFloat(todayMatch[1].replace(/,/g, "")) * 1000;
		const cost = Number.parseFloat(todayMatch[2].replace(/,/g, ""));
		if (Number.isFinite(tokens) && Number.isFinite(cost)) {
			return {
				kind: "today",
				value: { tokens, cost },
			};
		}
	}

	return { kind: "unknown", value: null };
}

export function buildFooterStatusValue(
	local: { today: { tokens: number; cost: number } },
	mirror: MirrorRecord | null,
	freshness: "fresh" | "stale" | "expired" | "missing",
): string {
	if (
		mirror &&
		freshness !== "expired" &&
		(mirror.h5_used_pct !== undefined || mirror.weekly_used_pct !== undefined)
	) {
		const quotaStatus = formatQuotaStatus({
			provider: "minimax",
			h5UsedPct: mirror.h5_used_pct ?? 0,
			h5ResetsAt: mirror.h5_resets_at,
			weeklyUsedPct: mirror.weekly_used_pct ?? 0,
			weeklyResetsAt: mirror.weekly_resets_at,
			scrapedAt: mirror.synced_at,
		});
		const freshnessSuffix =
			freshness === "fresh" || freshness === "missing" ? "" : ` · ${freshness}`;
		return `${quotaStatus.extended}${freshnessSuffix}`;
	}

	const todayStr = `${(local.today.tokens / 1000).toFixed(1)}k tok · $${local.today.cost.toFixed(3)}`;
	return `today: ${todayStr}`;
}

import type { MirrorRecord } from "./mirror.ts";
import { formatQuotaStatus } from "./harness/e2e/quota-status.js";

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

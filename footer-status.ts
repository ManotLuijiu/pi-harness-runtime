import type { MirrorRecord, ProviderMirrorRecord } from "./mirror.ts";
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

/** Display name for a provider id. Used as the footer label. */
function providerDisplayName(provider: string | null | undefined): string {
	if (!provider) return "Provider";
	switch (provider) {
		case "minimax":
			return "MiniMax";
		case "openai":
			return "OpenAI";
		case "openai-codex":
			return "OpenAI Codex";
		case "glm":
			return "GLM";
		case "anthropic":
			return "Anthropic";
		case "openrouter":
			return "OpenRouter";
		default:
			return provider;
	}
}

/** Hint shown when the provider has no usage data yet. */
function missingDataHint(
	provider: string | null | undefined,
	hasCookieSource: boolean,
): string {
	if (provider === "minimax") {
		return "drop minimax cookies into ~/.pi-harness-runtime/cookies/";
	}
	if (provider === "openai-codex") {
		return "will update on first TUI limit signal";
	}
	if (
		provider === "openai" ||
		provider === "glm" ||
		provider === "anthropic" ||
		provider === "openrouter"
	) {
		return "no signal yet (updates on first limit hit)";
	}
	if (!hasCookieSource) return "no usage source configured";
	return "no data yet";
}

/** Normalize an unknown mirror record into a ProviderMirrorRecord view. */
function toProviderView(
	mirror: MirrorRecord | ProviderMirrorRecord | null,
): ProviderMirrorRecord | null {
	if (!mirror) return null;
	const m = mirror as ProviderMirrorRecord;
	if (typeof m.provider === "string") return m;
	// Legacy flat-shape: already a single record without a provider wrapper.
	return {
		synced_at: m.synced_at ?? new Date().toISOString(),
		provider: (m as MirrorRecord).provider ?? "",
		source: "scrape",
		model: (m as MirrorRecord).model,
		h5_used_pct: (m as MirrorRecord).h5_used_pct,
		h5_resets_at: (m as MirrorRecord).h5_resets_at,
		weekly_used_pct: (m as MirrorRecord).weekly_used_pct,
		weekly_resets_at: (m as MirrorRecord).weekly_resets_at,
	};
}

export function buildFooterStatusValue(
	local: { today: { tokens: number; cost: number } },
	mirror: MirrorRecord | ProviderMirrorRecord | null,
	freshness: "fresh" | "stale" | "expired" | "missing",
	hasCookieSource: boolean = true,
	activeProvider: string | null = null,
): string {
	const view = toProviderView(mirror);
	const provider = activeProvider ?? view?.provider ?? null;
	const label = providerDisplayName(provider);

	// Continuous data path: a fresh record has 5h or weekly percentages.
	if (
		view &&
		freshness !== "expired" &&
		(view.h5_used_pct !== undefined || view.weekly_used_pct !== undefined)
	) {
		const quotaStatus = formatQuotaStatus({
			provider: (provider ?? "minimax") as "minimax",
			h5UsedPct: view.h5_used_pct ?? 0,
			h5ResetsAt: view.h5_resets_at,
			weeklyUsedPct: view.weekly_used_pct ?? 0,
			weeklyResetsAt: view.weekly_resets_at,
			scrapedAt: view.synced_at,
		});
		const freshnessSuffix =
			freshness === "fresh" || freshness === "missing" ? "" : ` · ${freshness}`;
		return `${label}: ${quotaStatus.extended}${freshnessSuffix}`;
	}

	// TUI-signal path: an exhausted record from a limit hit.
	if (
		view &&
		view.exhausted &&
		(view.limitType !== undefined || view.resets_at !== undefined)
	) {
		const reset = view.resets_at ?? view.h5_resets_at ?? "soon";
		return `${label}: limit hit (${view.limitType ?? "tokens"}), reset ${reset}`;
	}

	// Discoverable hint when we have no data yet.
	if (
		provider &&
		(!view || freshness === "expired" || freshness === "missing")
	) {
		const hint = missingDataHint(provider, hasCookieSource);
		// MiniMax-on-fresh-machine still gets the cookie hint; for others
		// the hint explains the signal-driven design.
		if (provider === "minimax" && !hasCookieSource) {
			return `${label}: 5h: -- (${hint})`;
		}
		return `${label}: 5h: -- · week: -- (${hint})`;
	}

	// Silent fallback: only reached if we genuinely don't know the provider.
	// No "5h/week: --" line here because we'd be making up data.
	const todayStr = `${(local.today.tokens / 1000).toFixed(1)}k tok · $${local.today.cost.toFixed(3)}`;
	return `today: ${todayStr}`;
}

import type { MirrorRecord, ProviderMirrorRecord } from "./mirror.ts";

import {
	parseContextWindowStatusLine,
	parseQuotaUsageStatusLine,
	type ParsedContextWindowUsage,
	type ParsedQuotaUsageData,
} from "./status-parsers.ts";

/**
 * Format countdown seconds into a human-readable string for TUI display.
 * Examples: "4h 32m", "45m 12s", "12s"
 */
export function formatCountdownForDisplay(seconds: number): string {
	if (seconds <= 0) return "RESET";

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`;
	}
	return `${secs}s`;
}

/**
 * Build a TUI-signal exhaustion status line with optional countdown.
 * This is used when a provider (like GLM) hits its limit.
 */
export function buildExhaustionStatusLine(
	provider: string,
	view: ProviderMirrorRecord,
	countdownSeconds?: number,
): string {
	const label = providerDisplayName(provider);
	const limitType = view.limitType ?? "tokens";
	const reset = view.resets_at ?? view.h5_resets_at ?? "soon";

	if (countdownSeconds !== undefined && countdownSeconds > 0) {
		const countdown = formatCountdownForDisplay(countdownSeconds);
		return `${label}: ⏳ ${countdown} (${limitType} hit)`;
	}

	return `${label}: limit hit (${limitType}), reset ${reset}`;
}
import { getProviderLabel } from "./packages/types/src/ai-providers.js";
import {
	providerHasContinuousScrape,
	providerHasTUISignal,
} from "./packages/providers/src/provider-id.js";

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

/**
 * Get display label for a provider id.
 * Uses the canonical getProviderLabel() from packages/types/src/ai-providers.ts
 * which handles all 9 known providers: minimax, openai, anthropic, glm,
 * openrouter, openai-codex, deepseek, gemini, kimi.
 */
function providerDisplayName(provider: string | null | undefined): string {
	if (!provider) return "Provider";
	return getProviderLabel(provider);
}

/**
 * Hint shown when the provider has no usage data yet.
 * Covers all 9 known providers from KNOWN_AI_PROVIDERS.
 */
function missingDataHint(
	provider: string | null | undefined,
	hasCookieSource: boolean,
): string {
	if (!provider) return "no usage source configured";

	// MiniMax: needs cookies for continuous scrape
	if (provider === "minimax") {
		return hasCookieSource
			? "no data yet (updates after first scrape)"
			: "drop minimax cookies into ~/.pi-harness-runtime/cookies/";
	}

	// TUI signal providers: one-shot signal on limit hit
	if (providerHasTUISignal(provider)) {
		return "no signal yet (updates on first limit hit)";
	}

	// Providers without any tracking implementation yet
	// deepseek, gemini, kimi, or any unknown provider
	if (provider === "deepseek") {
		return "deepseek usage tracking not yet implemented";
	}
	if (provider === "gemini") {
		return "gemini usage tracking not yet implemented";
	}
	if (provider === "kimi") {
		return "kimi usage tracking not yet implemented";
	}

	// Generic fallback for any other unknown provider
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

	// TUI-signal exhaustion path: fires when limit is hit (one-shot signal).
	// This takes priority over continuous data to show the most recent state.
	if (
		provider &&
		view &&
		view.exhausted &&
		(view.limitType !== undefined ||
			view.resets_at !== undefined ||
			view.h5_resets_at !== undefined)
	) {
		const reset = view.resets_at ?? view.h5_resets_at ?? "soon";
		const limitType = view.limitType ?? "tokens";
		return `${label}: limit hit (${limitType}), reset ${reset}`;
	}

	// Continuous data path: providers with continuous scrape (MiniMax has 5h+weekly, OpenAI has weekly-only)
	if (
		provider &&
		providerHasContinuousScrape(provider) &&
		view &&
		freshness !== "expired" &&
		(view.h5_used_pct !== undefined || view.weekly_used_pct !== undefined)
	) {
		const weeklyPct = view.weekly_used_pct ?? 0;
		const weeklyLeft = Math.max(0, 100 - weeklyPct);
		const weeklyResets = view.weekly_resets_at ?? "soon";

		let statusLine: string;
		if (view.h5_used_pct === undefined) {
			// OpenAI: weekly-only (no 5h window)
			statusLine = `week: ${weeklyLeft.toFixed(0)}% left (resets ${weeklyResets})`;
		} else {
			// MiniMax: has both 5h and weekly windows
			const h5Pct = view.h5_used_pct;
			const h5Left = Math.max(0, 100 - h5Pct);
			statusLine = `5h: ${h5Left.toFixed(0)}% left · week: ${weeklyLeft.toFixed(0)}% left`;
		}

		const freshnessSuffix =
			freshness === "fresh" || freshness === "missing" ? "" : ` · ${freshness}`;
		return `${label}: ${statusLine}${freshnessSuffix}`;
	}

	// TUI signal providers (OpenAI, Anthropic, GLM, OpenRouter):
	// Show monitoring status when we have a record but haven't hit limits.
	// These providers only emit data when a limit is hit.
	if (
		provider &&
		providerHasTUISignal(provider) &&
		view &&
		freshness !== "expired"
	) {
		// If exhausted is not set, we're monitoring normally
		if (!view.exhausted) {
			return `${label}: monitoring (no limits hit)`;
		}
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

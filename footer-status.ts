import type { MirrorRecord, ProviderMirrorRecord } from "./mirror.ts";
import type { CookieSourceStage } from "./packages/cookie-sanitizer/src/source-state.ts";
import type { QuotaAuthSource } from "./harness/quota-refresh-coordinator.ts";

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
 * Get a human-readable limit type label.
 * Special cases for GLM's 5h quota limit.
 */
function getLimitTypeLabel(provider: string, limitType?: string): string {
	// GLM specific: 5h quota limit
	if (provider === "glm" && limitType === "rate_limit") {
		return "5h quota";
	}
	return limitType ?? "tokens";
}

/**
 * The text for a reset that is not known.
 *
 * A missing reset is not a near reset. "resets soon" claimed a timing that
 * the runtime does not have; the honest text says that the reset time is
 * unknown.
 */
export const UNKNOWN_RESET_TEXT = "reset time unknown";

/**
 * Format reset time for display.
 * Converts ISO strings or human-readable times to a compact format.
 */
function formatResetTime(resetAt?: string): string {
	if (!resetAt) return UNKNOWN_RESET_TEXT;

	// If it's already a short human-readable string, return as-is
	if (/^\d+\s*(hr|min|day|d|h|m|s)/i.test(resetAt)) {
		return resetAt;
	}

	// Try to parse as ISO datetime
	const date = new Date(resetAt);
	if (!isNaN(date.getTime())) {
		// Format as "Aug 25 01:47" or similar
		const now = new Date();
		const sameYear = date.getFullYear() === now.getFullYear();
		const sameDay = date.toDateString() === now.toDateString();

		const timeStr = date.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});

		if (sameDay) {
			return `today ${timeStr}`;
		}

		const month = date.toLocaleString("en-US", { month: "short" });
		const day = date.getDate();

		if (sameYear) {
			return `${month} ${day} ${timeStr}`;
		}

		return `${month} ${day} ${date.getFullYear()} ${timeStr}`;
	}

	return resetAt;
}

/**
 * The phrase that names a reset.
 *
 * "resets Aug 25 01:47" when the reset is known, "reset time unknown" when
 * it is not.
 */
function formatResetPhrase(resetAt?: string): string {
	if (!resetAt) return UNKNOWN_RESET_TEXT;
	return `resets ${formatResetTime(resetAt)}`;
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
	const limitTypeLabel = getLimitTypeLabel(provider, view.limitType);
	const resetPhrase = formatResetPhrase(view.resets_at ?? view.h5_resets_at);

	if (countdownSeconds !== undefined && countdownSeconds > 0) {
		const countdown = formatCountdownForDisplay(countdownSeconds);
		return `${label}: ⏳ ${countdown} (${limitTypeLabel})`;
	}

	return `${label}: ${limitTypeLabel} hit, ${resetPhrase}`;
}
import { getProviderLabel } from "./packages/types/src/ai-providers.ts";
import {
	providerHasContinuousScrape,
	providerHasTUISignal,
} from "./packages/providers/src/provider-id.ts";

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
 * The state of the credential source, as the footer needs it.
 *
 * The stage says whether a credential was found and imported; the last
 * fetch says whether the provider accepted it. They are different facts
 * and the footer keeps them apart.
 */
export interface FooterQuotaSource {
	/** How far the cookie source got. */
	stage: CookieSourceStage;
	/** The outcome of the last fetch, when one ran. */
	lastFetch?: {
		ok: boolean;
		source: QuotaAuthSource;
		reason?: string;
	} | null;
}

/**
 * Hint shown when the provider has no usage data yet.
 * Covers all 9 known providers from KNOWN_AI_PROVIDERS.
 */
function missingDataHint(
	provider: string | null | undefined,
	source: FooterQuotaSource,
): string {
	if (!provider) return "no usage source configured";

	let hint: string;

	// MiniMax: needs cookies for continuous scrape
	if (provider === "minimax") {
		if (source.stage === "none") {
			hint = "drop minimax cookies into ~/.pi-harness-runtime/cookies/";
		} else if (source.stage === "discovered") {
			// A file was found but the import did not publish a cache.
			hint = "the cookie file was found but not imported yet";
		} else {
			hint = "no data yet (updates after first scrape)";
		}
	} else if (providerHasTUISignal(provider)) {
		// TUI signal providers: one-shot signal on limit hit
		hint = "no signal yet (updates on first limit hit)";
	} else if (provider === "deepseek") {
		// Providers without any tracking implementation yet
		hint = "deepseek usage tracking not yet implemented";
	} else if (provider === "gemini") {
		hint = "gemini usage tracking not yet implemented";
	} else if (provider === "kimi") {
		hint = "kimi usage tracking not yet implemented";
	} else if (source.stage === "none") {
		// Generic fallback for any other unknown provider
		hint = "no usage source configured";
	} else {
		hint = "no data yet";
	}

	const lastFetch = source.lastFetch;
	if (lastFetch && !lastFetch.ok && lastFetch.reason) {
		return `${hint} (the last refresh failed: ${lastFetch.reason})`;
	}
	return hint;
}

/**
 * The window line of a provider that reports percentages.
 *
 * Returns null when the record holds no percentage: a missing window is
 * not a window of zero.
 */
function windowStatusLine(
	provider: string,
	view: ProviderMirrorRecord,
): string | null {
	if (view.h5_used_pct === undefined && view.weekly_used_pct === undefined) {
		return null;
	}
	const weeklyPct = view.weekly_used_pct ?? 0;
	const weeklyLeft = Math.max(0, 100 - weeklyPct);
	const weeklyResets = formatResetPhrase(view.weekly_resets_at);

	if (view.h5_used_pct === undefined) {
		// OpenAI: weekly-only (no 5h window)
		return `week: ${weeklyLeft.toFixed(0)}% left (${weeklyResets})`;
	}

	// MiniMax/GLM: has both 5h and weekly windows
	const h5Left = Math.max(0, 100 - view.h5_used_pct);
	return `5h: ${h5Left.toFixed(0)}% left (${formatResetPhrase(view.h5_resets_at)}) - week: ${weeklyLeft.toFixed(0)}% left (${weeklyResets})`;
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
	source: FooterQuotaSource = { stage: "imported" },
	activeProvider: string | null = null,
): string {
	const view = toProviderView(mirror);
	const provider = activeProvider ?? view?.provider ?? null;
	const label = providerDisplayName(provider);

	// TUI-signal exhaustion path: fires when limit is hit (one-shot signal).
	// A signal is not proof that an allowance is zero, so the window
	// percentages stay visible next to the signal when the record holds
	// them: the failure information and the valid percentages are separate
	// facts.
	if (
		provider &&
		view &&
		view.exhausted &&
		(view.limitType !== undefined ||
			view.resets_at !== undefined ||
			view.h5_resets_at !== undefined)
	) {
		const limitTypeLabel = getLimitTypeLabel(
			provider,
			view.limitType ?? undefined,
		);
		const exhaustionNote = `${limitTypeLabel} hit, ${formatResetPhrase(view.resets_at ?? view.h5_resets_at)}`;
		const windows = windowStatusLine(provider, view);
		if (windows) {
			const suffix =
				freshness === "fresh" || freshness === "missing" ? "" : ` · ${freshness}`;
			return `${label}: ${windows} · ${exhaustionNote}${suffix}`;
		}
		return `${label}: ${exhaustionNote}`;
	}

	// Continuous data path: providers with continuous scrape (MiniMax has 5h+weekly, OpenAI has weekly-only)
	if (
		provider &&
		providerHasContinuousScrape(provider) &&
		view &&
		freshness !== "expired" &&
		(view.h5_used_pct !== undefined || view.weekly_used_pct !== undefined)
	) {
		const statusLine = windowStatusLine(provider, view) ?? "";

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
		const hint = missingDataHint(provider, source);
		// MiniMax-on-fresh-machine still gets the cookie hint; for others
		// the hint explains the signal-driven design.
		if (provider === "minimax" && source.stage === "none") {
			return `${label}: 5h: -- (${hint})`;
		}
		return `${label}: 5h: -- · week: -- (${hint})`;
	}

	// Silent fallback: only reached if we genuinely don't know the provider.
	// No "5h/week: --" line here because we'd be making up data.
	const todayStr = `${(local.today.tokens / 1000).toFixed(1)}k tok · $${local.today.cost.toFixed(3)}`;
	return `today: ${todayStr}`;
}

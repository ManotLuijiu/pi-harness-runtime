/**
 * Status Line Parsers
 *
 * Keep quota usage data and model context usage separate:
 * - Quota usage data: h5_used_pct / weekly_used_pct
 * - Context window usage: 68.4%/205k
 */

export interface ParsedQuotaUsageData {
	h5UsedPct: number | null;
	weeklyUsedPct: number | null;
}

export interface ParsedContextWindowUsage {
	usagePct: number;
	contextWindowTokens: number;
	usedTokens: number;
}

function parseTokenCount(raw: string): number | null {
	const trimmed = raw.trim().replace(/,/g, '');
	const match = trimmed.match(/^(\d+(?:\.\d+)?)([kKmMbB]?)$/);
	if (!match) return null;

	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value)) return null;

	const suffix = match[2].toLowerCase();
	if (suffix === 'k') return Math.round(value * 1_000);
	if (suffix === 'm') return Math.round(value * 1_000_000);
	if (suffix === 'b') return Math.round(value * 1_000_000_000);
	return Math.round(value);
}

/**
 * Parse a quota usage status line such as `5h: 100% left · week: 26% left`.
 * Returns the underlying usage fields used by the mirror: `h5_used_pct` and
 * `weekly_used_pct`.
 */
export function parseQuotaUsageStatusLine(
	value: string,
): ParsedQuotaUsageData | null {
	const h5Match = value.match(/5h:\s*(\d+(?:\.\d+)?)%\s*left/i);
	const weeklyMatch = value.match(/week:\s*(\d+(?:\.\d+)?)%\s*left/i);

	if (!h5Match && !weeklyMatch) {
		return null;
	}

	const h5Left = h5Match ? Number.parseFloat(h5Match[1]) : null;
	const weeklyLeft = weeklyMatch ? Number.parseFloat(weeklyMatch[1]) : null;

	return {
		h5UsedPct:
			h5Left === null || !Number.isFinite(h5Left) ? null : 100 - h5Left,
		weeklyUsedPct:
			weeklyLeft === null || !Number.isFinite(weeklyLeft)
				? null
				: 100 - weeklyLeft,
	};
}

/**
 * Parse a context-window status line such as `68.4%/205k`.
 * Returns the usage percentage, total context window, and inferred used tokens.
 */
export function parseContextWindowStatusLine(
	value: string,
): ParsedContextWindowUsage | null {
	const match = value.match(/(\d+(?:\.\d+)?)%\s*\/\s*([\d,.]+(?:[kKmMbB])?)/);
	if (!match) return null;

	const usagePct = Number.parseFloat(match[1]);
	const contextWindowTokens = parseTokenCount(match[2]);
	if (!Number.isFinite(usagePct) || contextWindowTokens === null) {
		return null;
	}

	return {
		usagePct,
		contextWindowTokens,
		usedTokens: Math.round((contextWindowTokens * usagePct) / 100),
	};
}

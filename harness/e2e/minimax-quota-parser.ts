export interface ParsedMiniMaxQuotaData {
	h5UsedPct?: number;
	h5ResetsAt?: string;
	weeklyUsedPct?: number;
	weeklyResetsAt?: string;
	monthlyUsedPct?: number;
	monthlyResetsAt?: string;
	creditBalance?: string;
	tokenUsage?: {
		currentMonth: string;
		last7Days: string;
		last30Days: string;
		total: string;
	};
}

/**
 * Strip trailing timestamp / reset-window noise that flattened innerText
 * concatenates onto values (e.g. "1 day 13 hr 00 UTC", "No credits yet 00 UTC").
 */
function stripTrailingNoise(value: string): string {
	return value
		.replace(/\s+\d{1,2}(?::\d{2})?\s+UTC.*$/i, "")
		.replace(/\s+UTC.*$/i, "")
		.replace(/\s+resets?\s+in\s+.*$/i, "")
		.replace(/\s*\.{2,}.*$/, "")
		.trim();
}

/**
 * Parse quota data from visible MiniMax usage page text.
 */
export function parseMiniMaxQuotaText(text: string): ParsedMiniMaxQuotaData {
	const data: ParsedMiniMaxQuotaData = {};
	const normalized = text.replace(/\r/g, "");

	const h5Match = normalized.match(
		/5h(?:\s+limit)?[\s\S]{0,200}?Used\s*(\d+(?:\.\d+)?)\s*%/i,
	);
	if (h5Match) {
		data.h5UsedPct = parseFloat(h5Match[1]);
	}

	const h5ResetMatch = normalized.match(
		/5h(?:\s+limit)?[\s\S]{0,200}?Resets?\s+in\s+([^\n%]+)/i,
	);
	if (h5ResetMatch) {
		data.h5ResetsAt = stripTrailingNoise(h5ResetMatch[1]);
	}

	const weeklyMatch = normalized.match(
		/week(?:ly)?(?:\s+limit)?[\s\S]{0,200}?Used\s*(\d+(?:\.\d+)?)\s*%/i,
	);
	if (weeklyMatch) {
		data.weeklyUsedPct = parseFloat(weeklyMatch[1]);
	}

	const weeklyResetMatch = normalized.match(
		/week(?:ly)?(?:\s+limit)?[\s\S]{0,200}?Resets?\s+in\s+([^\n%]+)/i,
	);
	if (weeklyResetMatch) {
		data.weeklyResetsAt = stripTrailingNoise(weeklyResetMatch[1]);
	}

	const creditMatch = normalized.match(
		/credit(?:\s+balance)?[^:\n]*:\s*([^\n]+)/i,
	);
	if (creditMatch) {
		const cleaned = stripTrailingNoise(creditMatch[1]);
		if (cleaned) {
			data.creditBalance = cleaned;
		}
	}

	const tokenSectionMatch = normalized.match(
		/token[^:]*:?\s*([\d.,]+\s*(?:M|B|K)?\s*tokens?)/gi,
	);
	if (tokenSectionMatch) {
		data.tokenUsage = {
			currentMonth: tokenSectionMatch[0] || "",
			last7Days: tokenSectionMatch[1] || "",
			last30Days: tokenSectionMatch[2] || "",
			total: tokenSectionMatch[3] || "",
		};
	}

	return data;
}

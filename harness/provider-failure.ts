/**
 * The kind of a provider failure.
 *
 * A failure of a provider is not one thing: a temporary limit recovers, an
 * exhausted plan does not, and a rejected credential never recovers by
 * waiting. The kind decides whether an automatic retry may be scheduled at
 * all, so the classification belongs before the retry policy.
 *
 * The kinds are deliberately few. An unknown failure stays unknown: it must
 * never be turned into an approval, a completion, or an unlimited retry.
 */
export type ProviderFailureKind =
	/** A temporary limit. A `Retry-After` may name the deadline. */
	| "rate-limit"
	/** A temporary overload of the provider, without a supplied deadline. */
	| "overload"
	/** The plan, the credit, or the quota of the account is exhausted. */
	| "usage-exhausted"
	/** The credential was rejected. Waiting does not help. */
	| "credentials"
	/** The failure could not be classified. */
	| "unknown";

/**
 * The policy that decides the deadline of a retry.
 *
 * The classification names the failure; the policy names what may happen
 * next. They are apart, because the same failure may be recovered by a
 * stated deadline, by a bounded backoff, or not at all.
 */
export type ProviderRecoveryPolicy =
	/** No automatic retry. The failure waits for a human. */
	| "none"
	/** The evidence states the deadline. The retry runs at that deadline. */
	| "retry-after"
	/** A bounded backoff of the provider decides the deadline. */
	| "backoff"
	/**
	 * A bounded recovery cycle of the harness decides the deadline.
	 *
	 * The cycle is finite (four attempts at most) and every deadline it
	 * picks is a *next attempt*, never a promised recovery of the provider.
	 */
	| "bounded-recovery";

/**
 * A classified provider failure.
 */
export interface ProviderFailure {
	/** The kind of the failure. */
	kind: ProviderFailureKind;
	/** May an automatic retry help? */
	retryable: boolean;
	/** The policy that decides the deadline of the retry. */
	recovery: ProviderRecoveryPolicy;
	/**
	 * The window the limit belongs to, when the evidence names one.
	 *
	 * A reset of the provider may only be used as the floor of a retry
	 * when it belongs to the same window ("h5", "weekly", ...). A failure
	 * that names no window has no window, so no reset applies to it.
	 */
	window?: string;
	/**
	 * The validated deadline of a retry in milliseconds.
	 *
	 * It is only set when the evidence carries one. A failure without a
	 * deadline has no `retryAfterMs`: a made-up deadline is a lie in the
	 * status row.
	 */
	retryAfterMs?: number;
	/** The code the provider reported (429, 2067, ...). */
	code?: string;
	/** The provider the failure names, when the evidence names one. */
	provider?: string;
	/** A short, truthful reason for a status row. */
	reason: string;
}

/**
 * The wrapper a client puts around the failure it retried.
 *
 * "Retry failed after 3 attempts: <the real error>" says how often the
 * client tried; the real error is what classifies the failure.
 */
const RETRY_WRAPPER = /Retry failed after\s+(\d+)\s+attempts\s*:\s*([\s\S]*)$/i;

/**
 * The usage exhaustion of a plan, a credit, or a quota.
 *
 * The check comes first: the message of a plan limit also says "rate
 * limit", so the rate limit pattern would otherwise win.
 */
const USAGE_EXHAUSTED = [
	/usage limit (?:has been|was|is) reached/i,
	/token plan usage limit/i,
	/insufficient[ _-]?(?:quota|balance|credits?|funds)/i,
	/quota (?:exhausted|used up)/i,
	/out of credits/i,
	/billing (?:hard )?limit/i,
	/\b2067\b/,
];

/** A temporary limit of the provider. */
const RATE_LIMIT = [/\brate[ _-]?limit/i, /too many requests/i, /\b429\b/];

/** A temporary overload of the provider. */
const OVERLOAD = [
	/overloaded_error/i,
	/peak-hour surge/i,
	/temporarily busy/i,
	/try again shortly/i,
	/\b529\b/,
	/\b2064\b/,
	/timed[ _-]?out/i,
];

/** A rejected credential. */
const CREDENTIALS = [
	/unauthorized/i,
	/invalid[ _-]?api[ _-]?key/i,
	/authentication (?:failed|error)/i,
	/permission denied/i,
	/\b401\b/,
	/\b403\b/,
];

/**
 * The output limit of the session.
 *
 * It is not a failure of the provider: the session ran out of output, and
 * the continuation of the output limit owns it. The classifier leaves it
 * alone, so no blocked row appears next to that continuation.
 */
const OUTPUT_LIMIT = [
	/maximum output token limit/i,
	/output[ _-]?token[ _-]?limit/i,
	/output[ _-]?limit/i,
	/max_output_tokens/i,
	/max_tokens/i,
];

/** The codes the providers of this harness are known by. */
const PROVIDER_BY_CODE: Record<string, string> = {
	"2064": "GLM",
	"2067": "MiniMax",
	"529": "Anthropic",
};

/**
 * The window a limit belongs to, when the evidence names one.
 *
 * The window decides whether a reset may be used as the floor of a retry:
 * a reset of the five-hour window says nothing about a plan limit that the
 * provider does not tie to a window.
 */
export function detectLimitWindow(text: string): string | undefined {
	if (/\b5[\s-]?h(?:our)?s?\b|\bh5\b|\bhourly\b|\bper hour\b/i.test(text)) return "h5";
	if (/\bweekly\b|\bper week\b/i.test(text)) return "weekly";
	if (/\bmonthly\b|\bper month\b/i.test(text)) return "monthly";
	if (/\bdaily\b|\bper day\b/i.test(text)) return "daily";
	return undefined;
}

/**
 * The inner failure of a retry wrapper.
 *
 * The wrapper is unwrapped so that the classification sees the real error;
 * the number of attempts is returned with it.
 */
export function unwrapRetryWrapper(text: string): {
	inner: string;
	attempts?: number;
	wrapped: boolean;
} {
	const match = RETRY_WRAPPER.exec(text.trim());
	if (!match) return { inner: text, wrapped: false };
	const attempts = Number.parseInt(match[1], 10);
	return {
		inner: match[2],
		attempts: Number.isFinite(attempts) ? attempts : undefined,
		wrapped: true,
	};
}

/**
 * The retry deadline that the evidence states.
 *
 * Only a stated deadline counts: "retry after 30 seconds" and "Retry-After:
 * 120" name one, and nothing else does. A deadline that the provider did
 * not state is never invented here.
 */
export function parseRetryAfterMs(text: string): number | undefined {
	// The minutes come first: a duration of minutes also matches the
	// pattern of the seconds, and "2 minutes" is not two seconds.
	const minutes = /retry[- ]?after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i.exec(
		text,
	);
	if (minutes) {
		const value = Number.parseFloat(minutes[1]);
		if (Number.isFinite(value) && value >= 0) return Math.round(value * 60_000);
	}
	const seconds = /retry[- ]?after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i.exec(
		text,
	);
	if (seconds) {
		const value = Number.parseFloat(seconds[1]);
		if (Number.isFinite(value) && value >= 0) return Math.round(value * 1000);
	}
	const bare = /retry[- ]?after\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i.exec(text);
	if (bare) {
		const value = Number.parseFloat(bare[1]);
		if (Number.isFinite(value) && value >= 0) return Math.round(value * 1000);
	}
	return undefined;
}

/**
 * The code the provider reported, when the evidence carries one.
 */
export function parseFailureCode(text: string): string | undefined {
	// A code is three digits (an HTTP status) or four (a provider code such
	// as 2067), so the pattern accepts both.
	const match = /(?:\(|code["'\s:=]+|status(?:\s+code)?["'\s:=]+)(\d{3,4})\b/i.exec(
		text,
	);
	if (!match) return undefined;
	const code = match[1];
	// A code that is not an HTTP status and not a provider code proves
	// nothing: the numbers in an error message are not always a code.
	if (code === "429" || code === "401" || code === "403" || code === "529") return code;
	if (code === "2064" || code === "2067") return code;
	return undefined;
}

/**
 * Classify a failure of a provider.
 *
 * `null` means that the text does not look like a failure at all, so the
 * caller can tell "no failure" from "a failure of an unknown kind".
 */
export function classifyProviderFailure(text: string | undefined): ProviderFailure | null {
	if (!text) return null;
	const raw = text.trim();
	if (raw.length === 0) return null;

	const { inner } = unwrapRetryWrapper(raw);
	const code = parseFailureCode(inner) ?? parseFailureCode(raw);
	const provider = code ? PROVIDER_BY_CODE[code] : undefined;
	const retryAfterMs = parseRetryAfterMs(inner) ?? parseRetryAfterMs(raw);
	const window = detectLimitWindow(inner) ?? detectLimitWindow(raw);

	const matches = (patterns: RegExp[]): boolean =>
		patterns.some((pattern) => pattern.test(inner) || pattern.test(raw));

	// The output limit of the session is not a failure of the provider: the
	// continuation of the output limit owns it.
	if (matches(OUTPUT_LIMIT)) return null;

	if (matches(USAGE_EXHAUSTED)) {
		return {
			kind: "usage-exhausted",
			// The plan of the account is exhausted. That is not the end of the
			// work: a bounded recovery cycle may still try, because the
			// provider can reject around a reset that the harness does not
			// see. The cycle is finite, and its deadline is the next attempt,
			// never a promised recovery.
			retryable: true,
			recovery: "bounded-recovery",
			...(window ? { window } : {}),
			// A stated deadline is a lower bound of the next attempt. It is
			// not the deadline of the attempt: the cycle may wait longer.
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
			...(code ? { code } : {}),
			...(provider ? { provider } : {}),
			reason: provider
				? `${provider} usage limit reached${code ? ` (${code})` : ""}`
				: `usage limit reached${code ? ` (${code})` : ""}`,
		};
	}

	if (matches(RATE_LIMIT)) {
		return {
			kind: "rate-limit",
			retryable: true,
			recovery: retryAfterMs !== undefined ? "retry-after" : "backoff",
			...(window ? { window } : {}),
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
			...(code ? { code } : {}),
			...(provider ? { provider } : {}),
			reason: `rate limited${code ? ` (${code})` : ""}`,
		};
	}

	if (matches(OVERLOAD)) {
		return {
			kind: "overload",
			retryable: true,
			recovery: "backoff",
			...(window ? { window } : {}),
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
			...(code ? { code } : {}),
			...(provider ? { provider } : {}),
			reason: provider
				? `${provider} is overloaded${code ? ` (${code})` : ""}`
				: `provider overloaded${code ? ` (${code})` : ""}`,
		};
	}

	if (matches(CREDENTIALS)) {
		return {
			kind: "credentials",
			retryable: false,
			recovery: "none",
			...(window ? { window } : {}),
			...(code ? { code } : {}),
			...(provider ? { provider } : {}),
			reason: `credentials rejected${code ? ` (${code})` : ""}`,
		};
	}

	// The text is not a known failure. It is only a failure when it looks
	// like one: an arbitrary text of an assistant message is not an error.
	if (!looksLikeFailure(raw)) return null;
	return {
		kind: "unknown",
		retryable: false,
		recovery: "none",
		...(code ? { code } : {}),
		reason: "provider error",
	};
}

/**
 * Whether the bounded recovery cycle of the harness owns the failure.
 *
 * The cycle is the backoff of the harness: a rate limit and an exhausted
 * plan are retried by it, whether the evidence names a deadline or not.
 * A rate limit without a `Retry-After` therefore still gets a finite
 * number of attempts, instead of nothing at all.
 *
 * An overload does not belong to the cycle: the provider says to come
 * back shortly, and the existing overload executor already retries with a
 * short delay and has its own limit. Two executors for one failure would
 * be two resume loops.
 */
export function usesBoundedRecovery(failure: ProviderFailure): boolean {
	if (failure.kind === "overload") return false;
	if (failure.kind === "credentials" || failure.kind === "unknown") return false;
	return (
		failure.recovery === "bounded-recovery" ||
		failure.recovery === "retry-after" ||
		failure.recovery === "backoff"
	);
}

/**
 * Does the text look like a failure at all?
 */
function looksLikeFailure(text: string): boolean {
	return (
		/\berror\b/i.test(text) ||
		/\bfailed\b/i.test(text) ||
		/\bfailure\b/i.test(text) ||
		/went wrong/i.test(text) ||
		/\bstatus\s*code\b/i.test(text) ||
		/\bhttp\s*\d{3}\b/i.test(text) ||
		/\bexceeded\b/i.test(text)
	);
}

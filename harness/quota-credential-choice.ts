/**
 * The choice of the credential of a quota refresh.
 *
 * Two credentials can answer a quota request:
 *
 *  - the browser profile: a logged-in session that needs no import,
 *  - the canonical cookie cache: the normalized output of the sanitizer.
 *
 * The browser profile comes first, and its success does not depend on the
 * drop folder at all: a machine whose drop file is malformed can still
 * read its quota through the profile.
 *
 * The cookie cache comes second, and only when an import published it. A
 * file that was found but not imported gives a scraper nothing to read,
 * and asking the provider with nothing is a failure with a name.
 */

import type { CookieSourceStage } from "../packages/cookie-sanitizer/src/source-state.ts";

/** The credential that answers a quota refresh. */
export type QuotaCredentialChoice = "browser-profile" | "cookie-cache" | "none";

/** The facts the choice is made from. */
export interface QuotaCredentialFacts {
	/**
	 * The outcome of the browser profile, when it ran.
	 *
	 * `ok` means the profile held a quota reading.
	 */
	browserProfile?: { ok: boolean; reason?: string } | null;
	/** The stage of the cookie source. */
	cookieStage: CookieSourceStage;
}

/**
 * Choose the credential of a quota refresh.
 *
 * The reason of a "none" names the failure, never a credential.
 */
export function chooseQuotaCredential(facts: QuotaCredentialFacts): {
	choice: QuotaCredentialChoice;
	reason?: string;
} {
	const profile = facts.browserProfile;
	if (profile?.ok) {
		return { choice: "browser-profile" };
	}

	if (facts.cookieStage === "imported") {
		return { choice: "cookie-cache" };
	}

	if (facts.cookieStage === "discovered") {
		return {
			choice: "none",
			reason:
				"the cookie file was found but not imported into the canonical cache",
		};
	}

	return {
		choice: "none",
		reason: profile?.reason
			? `no imported cookie cache is available (${profile.reason})`
			: "no imported cookie cache is available",
	};
}

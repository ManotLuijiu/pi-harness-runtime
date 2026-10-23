/**
 * The startup messages that report a missing credential.
 *
 * The messages are built by pure functions so that the rules can be tested
 * without starting the whole extension:
 *
 * - a missing credential must carry at least one `echo` command,
 * - the Jev line must keep its fix commands - `HarnessStartupStatus.update`
 *   replaces a message BY LABEL, so a later message with the same label
 *   would silently drop them,
 * - LINE must not be reported as configured when the audit could not run.
 */

import type { KeyFileAuditResult } from "./key-file-audit.ts";

export type StartupStatus = "wait" | "ok" | "warn" | "err";

export interface StartupReport {
	/** The label of the startup line ("Jev", "Relay", "LINE"). */
	label: string;
	/** The text of the line. */
	text: string;
	/** The status marker of the line. */
	status: StartupStatus;
	/** The fix instructions below the line. */
	details: string[];
}

/**
 * A one-line, length-limited version of an error message.
 *
 * The startup summary renders one line per service - a raw error message can
 * contain newlines (which break the tree) and can be very long (which buries
 * the instruction). A client error can also carry the relay url, and the url
 * can carry the auth token - a credential is never printed into the summary.
 */
export function oneLineError(error: unknown, maxLength = 160): string {
	const raw = error instanceof Error ? error.message : String(error);
	const flat = raw.replace(/\s+/g, " ").trim();
	// A credential can travel in many shapes - a url parameter, a url path
	// (the Telegram bot token), a header or a "name: value" pair. Every
	// shape is redacted; an ordinary word like "authorization failed" is not.
	const redacted = flat
		// A url parameter: ?token=... &api_key=...
		.replace(
			/((?:^|[?&;,\s])(?:[a-z0-9_-]*(?:token|auth|key|secret|password|passwd|pwd|jwt|session|sig)[a-z0-9_-]*)=)[^\s&"',;]+/gi,
			"$1<redacted>",
		)
		// A header with an unambiguous credential name - every value is
		// redacted ("token: x", "X-Api-Key: y").
		.replace(
			/(\b(?:x-)?(?:api[-_]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&"',;]+)/gi,
			"$1<redacted>",
		)
		// A header with an ambiguous name - only a value that looks like a
		// credential is redacted ("Authorization: Bearer x").
		.replace(
			/(\b(?:x-)?(?:authorization|auth|key|jwt|session|sig)\b\s*[:=]\s*)("[^"]*"|'[^']*'|Bearer\s+[^\s"',;]+|Basic\s+[^\s"',;]+|[A-Za-z0-9_.\-]{4,})/gi,
			"$1<redacted>",
		)
		// A url path: "/bot123456:ABC-DEF/", "/token/abc12345".
		// The boundary is "not a digit" and not a word boundary, so a
		// token that is glued to a word ("xbot123:ABC-DEF") is redacted
		// as well.
		.replace(/(^|[^0-9])\d{6,}:[A-Za-z0-9_\-]{4,}/g, "$1<redacted>")
		.replace(
			/(\/((?:access_token|api[-_]?key|token|secret)[=/]))[A-Za-z0-9_\-:]{4,}/gi,
			"$1<redacted>",
		)
		// A bare "Bearer x" without a header name.
		.replace(/(\bbearer\b\s+)[^\s"',;]+/gi, "$1<redacted>");
	return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}…` : redacted;
}

/**
 * The Jev line for a missing API key.
 *
 * The fix commands live in this message - nothing may replace it later.
 */
export function jevMissingKeyReport(fixes: string[]): StartupReport {
	return {
		label: "Jev",
		text: "API key missing; question detection active, auto-continue unavailable",
		status: "warn",
		details: [...fixes, "Or set TYPESAFE_API_KEY (or OPENROUTER_API_KEY) in the environment."],
	};
}

/**
 * Should the relay be reported at all?
 *
 * The relay is an optional feature: a user who never set it up must not see
 * a permanent warning with fix commands on every start. The line appears as
 * soon as a relay key file exists or as soon as the Telegram channel works
 * (the relay serves the Telegram callbacks).
 */
export function relayShouldBeReported(options: {
	hasRelayKeyFile: boolean;
	telegramConfigured: boolean;
}): boolean {
	return options.hasRelayKeyFile || options.telegramConfigured;
}

/**
 * The Relay line for an endpoint that is not fully configured.
 *
 * `reasons` names the real cause (e.g. "rejected source: env RELAY_WS_URL
 * (not a ws:// or wss:// URL)") so the user does not create a key file for a
 * problem that lives in the environment. It never contains a secret.
 */
export function relayEndpointReport(options: {
	missingUrl: boolean;
	missingToken: boolean;
	reasons: string[];
	fixes: string[];
}): StartupReport {
	let text = "two-way streaming off; no relay URL configured";
	if (options.missingUrl && options.missingToken) {
		text = "two-way streaming off; no relay endpoint configured";
	} else if (options.missingToken) {
		text = "two-way streaming off; no relay auth token configured";
	}
	// A warning without an instruction is not actionable: when the caller
	// could not produce a fix command, name the files to look at.
	const details = [...options.reasons, ...options.fixes];
	if (details.length === 0) {
		details.push(
			"Check the relay URL and the auth token in ~/.pi-harness-runtime/keys/ (relay-ws-url.txt, relay-auth-token.txt).",
		);
	}
	// Exactly one reload instruction - a fix that already mentions a reload
	// must not be followed by a second one.
	if (!details.some((detail) => /reload/i.test(detail))) {
		details.push("Then reload Pi.");
	}
	return {
		label: "Relay",
		text,
		status: "warn",
		details,
	};
}

/**
 * The LINE line.
 *
 * Returns null when LINE must not be reported at all: a user who never
 * touched LINE must not see a warning on every start. The line appears as
 * soon as one of the LINE client key files exists.
 *
 * The audit is passed in (and not read here) so that the rule "never report
 * LINE as configured when the audit failed" can be tested.
 */
export function lineConfigurationReport(options: {
	/** The audit result, or null when the audit could not run. */
	audit: KeyFileAuditResult | null;
	/** Does a LINE client key file exist (line-access-token.txt / line-user-id.txt)? */
	clientKeyFilePresent: boolean;
	/**
	 * The fix commands for Telegram.
	 *
	 * They are shown when the LINE channel cannot start because Telegram is
	 * not configured - the LINE line must not be the only warning without an
	 * action.
	 */
	telegramFixes?: string[];
	/**
	 * What happened to the LINE channel in this run?
	 *
	 * - "started"     = the channel was really initialized (the runtime
	 *                   reports the green line itself)
	 * - "failed"      = the credentials were there but the channel did not
	 *                   start
	 * - "not-started" = the channel was never started (the LINE channel is
	 *                   started inside initTelegram, which returns early when
	 *                   Telegram itself is not configured)
	 */
	channelState?: "started" | "failed" | "not-started";
	/** Is Telegram configured? The LINE channel starts together with it. */
	telegramConfigured?: boolean;
	/** The fix commands for the missing LINE credentials. */
	fixes: string[];
	/**
	 * The fix commands for the channel access token only.
	 *
	 * The startup check validates the ACCESS TOKEN. The user id is only the
	 * recipient of the messages, so a failed check must not point at
	 * line-user-id.txt.
	 */
	accessTokenFixes?: string[];
	/**
	 * Why the channel did not start (from the adapter).
	 *
	 * It says WHICH problem it is - an invalid or revoked token, a LINE API
	 * failure or a network failure - and it never contains a credential.
	 */
	channelDiagnostic?: string | null;
}): StartupReport | null {
	if (!options.clientKeyFilePresent) return null;
	const channelState = options.channelState ?? "not-started";
	if (!options.audit) {
		// The audit failed: LINE must not be reported as configured.
		const details = options.fixes.length > 0 ? options.fixes : [];
		if (details.length === 0) {
			details.push(
				"Check the LINE credentials in ~/.pi-harness-runtime/keys/ (line-access-token.txt, line-user-id.txt).",
			);
		}
		return {
			label: "LINE",
			text: "could not read the key files",
			status: "warn",
			details,
		};
	}
	const missing = options.audit.byFeature.get("LINE") ?? [];
	if (missing.length === 0) {
		if (channelState === "started") {
			// The runtime reported the green line itself ("configured and
			// enabled") - a second LINE line would only overwrite it.
			return null;
		}
		if (channelState === "failed") {
			// The credentials are there but the channel did not start - the
			// channel access token is what the startup check validates, so
			// the user id must not be named as the cause.
			const details = [
				...(options.accessTokenFixes && options.accessTokenFixes.length > 0
					? options.accessTokenFixes
					: options.fixes),
			];
			if (options.channelDiagnostic) {
				details.push(options.channelDiagnostic);
			}
			details.push(
				"The startup check validates the channel access token - the user id is only the recipient of the messages.",
			);
			details.push(
				"Fix the file, then reload Pi so the channel is checked again.",
			);
			return {
				label: "LINE",
				text: "configured but the LINE channel did not start",
				status: "warn",
				details,
			};
		}
		// The credentials are there but the channel was never started in this
		// run - say so instead of showing a green line. The cause differs:
		// without Telegram the channel cannot start at all, with Telegram the
		// credentials were simply created after the harness was loaded.
		const cause = options.telegramConfigured
			? "The LINE channel starts together with the Telegram channel - the key files were created after Pi was loaded."
			: "The LINE channel starts together with the Telegram channel - it cannot start before Telegram works.";
		return {
			label: "LINE",
			// The text names the action - a reload only helps when Telegram
			// works; otherwise the user has to configure Telegram first.
			text: options.telegramConfigured
				? "configured; reload Pi to enable the channel"
				: "configured; Telegram must be configured first",
			status: "warn",
			details: [
				cause,
				// Without Telegram the user needs the Telegram commands - the
				// line must not be the only warning without an action.
				...(options.telegramConfigured ? [] : (options.telegramFixes ?? [])),
			],
		};
	}
	return {
		label: "LINE",
		text: "not configured",
		status: "warn",
		details: [...options.fixes, "Configure LINE in ~/.pi-harness-runtime/keys/, then reload Pi."],
	};
}

/**
 * LINE Adapter — RFC-0022
 *
 * Sends notifications via LINE Messaging API.
 */

import type {
	NotificationPayload,
	NotificationResult,
	LineConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
import { formatDetailLines } from "./detail-format.js";

/**
 * The endpoint that validates a channel access token.
 *
 * LINE answers a user profile with `GET /v2/bot/profile/{userId}`. Without
 * the user id in the path that request is a 404 for every caller, so it can
 * never be used to check a credential - a valid token fails the check.
 * `GET /v2/bot/info` is the endpoint for the bot/channel itself and answers
 * 200 for a valid channel access token.
 */
export const LINE_BOT_INFO_URL = "https://api.line.me/v2/bot/info";

/**
 * How long the credential check may take.
 *
 * A check that never answers would hang the whole startup, so the request
 * is bounded. A timeout is reported as a network problem - LINE being slow
 * is not a credential problem.
 */
export const LINE_CHECK_TIMEOUT_MS = 5000;
/**
 * Describe a failed LINE credential check.
 *
 * The HTTP status says WHICH problem it is:
 * - 401/403: the channel access token is invalid, expired or revoked
 * - 404:     the endpoint is wrong (a LINE change, not a credential problem)
 * - 429:     LINE is rate limiting us
 * - 5xx:     the LINE API itself failed
 *
 * The body is only used for the short LINE error message and is always
 * redacted and truncated.
 */
export function describeLineFailure(
	status: number,
	body: string,
	token?: string,
): string {
	const safeBody = sanitizeLineText(body, token);
	const reason = (() => {
		if (status === 401 || status === 403) {
			return "the channel access token is invalid, expired or revoked";
		}
		if (status === 404) {
			return "the LINE bot-info endpoint answered 404 - the API path may have changed";
		}
		if (status === 429) {
			return "LINE is rate limiting the request";
		}
		if (status >= 500) {
			return "the LINE API failed";
		}
		return "the LINE API rejected the request";
	})();
	const suffix = safeBody ? ` (${safeBody})` : "";
	return `LINE HTTP ${status}: ${reason}${suffix}`;
}

/**
 * Make a LINE error body safe to show.
 *
 * The body is truncated, flattened to one line and the channel access token
 * is removed when it appears in it. A credential must never reach the
 * startup summary or the log file.
 */
export function sanitizeLineText(text: string, token?: string): string {
	let flat = (text ?? "").replace(/\s+/g, " ").trim();
	if (token && token.length > 0) {
		flat = flat.split(token).join("<redacted>");
	}
	// A long opaque blob is a credential even when the token itself is not
	// in the text.
	flat = flat.replace(/[A-Za-z0-9_\-]{24,}/g, "<redacted>");
	// The bot-token shape (a numeric id, a colon, a secret) - the same
	// shape the startup report redacts. The boundary is "not a digit" so a
	// token that is glued to a word is redacted as well.
	flat = flat.replace(/(^|[^0-9])\d{6,}:[A-Za-z0-9_\-]{4,}/g, "$1<redacted>");
	return flat.length > 100 ? `${flat.slice(0, 97)}...` : flat;
}

/**
 * Read a response body without letting a broken body hide the status.
 */
async function readBody(response: {
	text?: () => Promise<string>;
}): Promise<string> {
	try {
		return (await response.text?.()) ?? "";
	} catch {
		return "";
	}
}

export class LineAdapter extends BaseChannelAdapter {
	readonly id = "line";
	readonly type = "line";

	constructor(config: LineConfig) {
		super({ id: "line", type: "line", enabled: true, config });
	}

	async initialize(): Promise<boolean> {
		// The token is read OUTSIDE the try: a broken config must not turn
		// into an exception inside the catch block.
		const cfg = this.config.config as LineConfig | undefined;
		const token = cfg?.channelAccessToken ?? "";
		if (!token) {
			// Without a token there is nothing to check - this is a missing
			// credential, not a failed request.
			this.setDiagnostic(
				"no LINE channel access token configured (line-access-token.txt is missing or empty)",
			);
			return false;
		}
		try {
			// Verify the channel access token with the bot-info endpoint.
			const response = await fetch(LINE_BOT_INFO_URL, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
				signal: AbortSignal.timeout(LINE_CHECK_TIMEOUT_MS),
			});
			if (!response.ok) {
				this.setDiagnostic(
					describeLineFailure(response.status, await readBody(response), token),
				);
				return false;
			}
			// The token works - mark the channel healthy so the startup
			// summary can report the LINE channel as started.
			this.markHealthy();
			return true;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			const timedOut =
				error instanceof Error &&
				(error.name === "TimeoutError" || error.name === "AbortError");
			this.setDiagnostic(
				timedOut
					? `LINE network error: the request timed out after ${LINE_CHECK_TIMEOUT_MS}ms`
					: `LINE network error: ${sanitizeLineText(message, token)}`,
			);
			return false;
		}
	}

	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as LineConfig;
			const message = this.formatMessage(payload);

			const response = await fetch(
				"https://api.line.me/v2/bot/message/push",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${cfg.channelAccessToken}`,
					},
					body: JSON.stringify({
						to: cfg.userId,
						messages: [
							{
								type: "text",
								text: message,
							},
						],
					}),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				return {
					success: false,
					channel: this.id,
					// The error body is sanitized like every other LINE
					// text: a body that echoes the credential must not
					// reach the notification result or the log.
					error: `LINE API error: ${sanitizeLineText(
						error,
						typeof cfg.channelAccessToken === "string"
							? cfg.channelAccessToken
							: undefined,
					)}`,
				};
			}

			return { success: true, channel: this.id };
		} catch (error) {
			const cfg = this.config.config as LineConfig;
			return {
				success: false,
				channel: this.id,
				// The thrown value is sanitized like the HTTP error body: a
				// message that carries the credential must not reach the
				// notification result or the log.
				error: sanitizeLineText(
					error instanceof Error ? error.message : String(error),
					typeof cfg.channelAccessToken === "string"
						? cfg.channelAccessToken
						: undefined,
				),
			};
		}
	}

	private formatMessage(payload: NotificationPayload): string {
		const emoji = this.getEmoji(payload.event);
		const title = `${emoji} ${payload.title}`;
		const lines = [title, "", payload.message];

		if (payload.details?.taskTitle) {
			lines.push("", `Task: ${payload.details.taskTitle}`);
		}
		if (payload.details?.jobId) {
			lines.push(`Job: ${payload.details.jobId}`);
		}
		for (const detail of formatDetailLines(payload.details, payload.event)) {
			lines.push("", `${detail.label}: ${detail.value}`);
		}

		return lines.filter(Boolean).join("\n");
	}

	private getEmoji(event: NotificationPayload["event"]): string {
		const map: Record<string, string> = {
			JobStarted: "🚀",
			TaskCompleted: "✅",
			TaskFailed: "❌",
			QuotaPaused: "⏸️",
			ResumeScheduled: "▶️",
			ContextCompacted: "📦",
			OutputLimitContinued: "🔄",
			E2EFailed: "🧪",
			HumanReviewNeeded: "👤",
			ReadyForClient: "🎉",
			JobCancelled: "🚫",
			Error: "⚠️",
		};
		return map[event] ?? "📢";
	}
}

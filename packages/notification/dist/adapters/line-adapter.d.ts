/**
 * LINE Adapter — RFC-0022
 *
 * Sends notifications via LINE Messaging API.
 */
import type { NotificationPayload, NotificationResult, LineConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
/**
 * The endpoint that validates a channel access token.
 *
 * LINE answers a user profile with `GET /v2/bot/profile/{userId}`. Without
 * the user id in the path that request is a 404 for every caller, so it can
 * never be used to check a credential - a valid token fails the check.
 * `GET /v2/bot/info` is the endpoint for the bot/channel itself and answers
 * 200 for a valid channel access token.
 */
export declare const LINE_BOT_INFO_URL = "https://api.line.me/v2/bot/info";
/**
 * How long the credential check may take.
 *
 * A check that never answers would hang the whole startup, so the request
 * is bounded. A timeout is reported as a network problem - LINE being slow
 * is not a credential problem.
 */
export declare const LINE_CHECK_TIMEOUT_MS = 5000;
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
export declare function describeLineFailure(status: number, body: string, token?: string): string;
/**
 * Make a LINE error body safe to show.
 *
 * The body is truncated, flattened to one line and the channel access token
 * is removed when it appears in it. A credential must never reach the
 * startup summary or the log file.
 */
export declare function sanitizeLineText(text: string, token?: string): string;
export declare class LineAdapter extends BaseChannelAdapter {
    readonly id = "line";
    readonly type = "line";
    constructor(config: LineConfig);
    initialize(): Promise<boolean>;
    send(payload: NotificationPayload): Promise<NotificationResult>;
    private formatMessage;
    private getEmoji;
}
//# sourceMappingURL=line-adapter.d.ts.map
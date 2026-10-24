/**
 * LINE Adapter — RFC-0022
 *
 * Sends notifications via LINE Messaging API.
 */
import type { NotificationPayload, NotificationResult, LineConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
/**
 * LINE limits the template fields. The complete question does not fit in a
 * template, so it travels as a text message and the template only carries the
 * prompt and the request ID.
 */
export declare const LINE_TEMPLATE_TEXT_LIMIT = 200;
export declare const LINE_TEMPLATE_TITLE_LIMIT = 40;
export declare const LINE_ACTION_LABEL_LIMIT = 20;
/** LINE accepts at most 100 characters of postback data. */
export declare const LINE_POSTBACK_DATA_LIMIT = 100;
/** LINE accepts at most 4 actions in one template. */
export declare const LINE_MAX_ACTIONS = 4;
/** A LINE text message accepts up to 5000 characters. */
export declare const LINE_TEXT_MESSAGE_LIMIT = 4500;
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
    /**
     * Build the LINE messages of a payload.
     *
     * Without actions it is one text message. With actions the complete
     * question travels as a text message (a LINE text message holds far more
     * than a template) and a template carries the Yes/No postback actions.
     * Both messages carry the canonical request ID, so the user can tell
     * which request an action belongs to.
     */
    private buildMessages;
    /**
     * Split a long text into LINE sized text messages.
     */
    private chunkText;
    /**
     * The button label without its emoji. LINE counts the emoji in the 20
     * character label limit.
     */
    private formatActionLabel;
    private formatMessage;
    private getEmoji;
}
//# sourceMappingURL=line-adapter.d.ts.map
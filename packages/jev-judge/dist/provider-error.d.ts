/**
 * Provider errors for the Jev judge.
 *
 * The judge can talk to more than one provider (TypeSafe direct API first,
 * OpenRouter as a fallback). A failure therefore carries the information the
 * fallback logic needs: which provider failed, whether the failure was an
 * HTTP error, and whether ANOTHER provider could still serve the request.
 */
import type { JevProviderName } from "./types.js";
export interface JevProviderErrorOptions {
    provider: JevProviderName;
    /** HTTP status, when the failure came from an HTTP response. */
    status?: number;
    /**
     * True when another provider could still serve the request.
     *
     * Retryable: network failures, timeouts, rate limits, auth failures and
     * 5xx. NOT retryable: 400/422 - those are contract errors in the request
     * we build, and falling back would hide the bug.
     */
    retryable: boolean;
    cause?: unknown;
}
/**
 * Error raised by a single Jev provider call.
 */
export declare class JevProviderError extends Error {
    readonly provider: JevProviderName;
    readonly status?: number;
    readonly retryable: boolean;
    constructor(message: string, options: JevProviderErrorOptions);
}
/**
 * HTTP statuses where another provider (or a later attempt) can still help.
 */
export declare function isRetryableStatus(status: number): boolean;
/**
 * Extract an HTTP status from an unknown error value.
 */
export declare function extractStatus(error: unknown): number | undefined;
/**
 * True when the error is a known transport failure (network, timeout, abort).
 *
 * Only these are retryable without an HTTP status: they never reached a
 * server that could have rejected the request. Everything else without a
 * status (a bug in our own code, a malformed response, a parse error) is NOT
 * retryable - a contract bug must stay visible instead of being hidden behind
 * a fallback to another provider.
 */
export declare function isTransportError(error: unknown): boolean;
/**
 * Wrap any thrown value into a JevProviderError.
 *
 * A failure with an HTTP status is retryable when the status says so (see
 * `isRetryableStatus`). A failure WITHOUT a status is only retryable when it
 * is a known transport failure (network, timeout, abort) - an unknown error
 * is most likely a bug in our own code and must not disappear behind a
 * fallback to another provider.
 */
export declare function toProviderError(error: unknown, provider: JevProviderName): JevProviderError;
//# sourceMappingURL=provider-error.d.ts.map
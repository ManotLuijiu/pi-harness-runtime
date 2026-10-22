/**
 * Provider errors for the Jev judge.
 *
 * The judge can talk to more than one provider (TypeSafe direct API first,
 * OpenRouter as a fallback). A failure therefore carries the information the
 * fallback logic needs: which provider failed, whether the failure was an
 * HTTP error, and whether ANOTHER provider could still serve the request.
 */
/**
 * Error raised by a single Jev provider call.
 */
export class JevProviderError extends Error {
    provider;
    status;
    retryable;
    constructor(message, options) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = "JevProviderError";
        this.provider = options.provider;
        this.status = options.status;
        this.retryable = options.retryable;
    }
}
/**
 * HTTP statuses where another provider (or a later attempt) can still help.
 */
export function isRetryableStatus(status) {
    if (status === 401 || status === 402 || status === 403)
        return true; // auth / quota
    if (status === 408 || status === 429)
        return true; // timeout / rate limit
    if (status >= 500)
        return true; // server side
    return false;
}
/**
 * Extract an HTTP status from an unknown error value.
 */
export function extractStatus(error) {
    if (typeof error !== "object" || error === null)
        return undefined;
    const status = error.status;
    return typeof status === "number" ? status : undefined;
}
/**
 * Error names of the known TRANSPORT failures: the request never reached a
 * server that could reject it, so another provider can still serve it.
 */
const TRANSPORT_ERROR_NAMES = new Set([
    "AbortError",
    "TimeoutError",
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "APITimeoutError",
    "FetchError",
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
]);
/** Error codes of the known transport failures. */
const TRANSPORT_ERROR_CODES = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENETDOWN",
    "ENETUNREACH",
    "EHOSTDOWN",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "EPROTO",
    "EPIPE",
    "ETIMEDOUT",
    "ERR_STREAM_PREMATURE_CLOSE",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
    // Certificate verification failures: the endpoint is unreachable for us.
    "CERT_HAS_EXPIRED",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
/**
 * Prefixes of the error codes that always describe a transport failure.
 *
 * undici reports its own failures as UND_ERR_*, the TLS stack as ERR_TLS_*
 * and the network stack as ECONN / EHOST / ENET.
 */
const TRANSPORT_ERROR_CODE_PREFIXES = [
    "UND_ERR_",
    "ERR_TLS_",
    "ECONN",
    "EHOST",
    "ENET",
    "CERT_",
    "SELF_SIGNED_CERT_",
    "DEPTH_ZERO_",
    "UNABLE_TO_VERIFY_",
];
/**
 * True when the error is a known transport failure (network, timeout, abort).
 *
 * Only these are retryable without an HTTP status: they never reached a
 * server that could have rejected the request. Everything else without a
 * status (a bug in our own code, a malformed response, a parse error) is NOT
 * retryable - a contract bug must stay visible instead of being hidden behind
 * a fallback to another provider.
 */
export function isTransportError(error) {
    if (typeof error !== "object" || error === null)
        return false;
    const named = error;
    if (typeof named.name === "string" && TRANSPORT_ERROR_NAMES.has(named.name))
        return true;
    if (typeof named.code === "string" && isTransportCode(named.code))
        return true;
    // An AggregateError collects the failures of several addresses (undici
    // tries them one after the other) - one of them being a transport
    // failure makes the whole attempt a transport failure.
    if (Array.isArray(named.errors) && named.errors.some((entry) => isTransportError(entry))) {
        return true;
    }
    // Node/undici wrap the real cause (e.g. ECONNREFUSED) one level deeper.
    if (named.cause !== undefined && named.cause !== error) {
        return isTransportError(named.cause);
    }
    return false;
}
/**
 * True when the error code describes a transport failure.
 */
function isTransportCode(code) {
    if (TRANSPORT_ERROR_CODES.has(code))
        return true;
    return TRANSPORT_ERROR_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}
/**
 * Wrap any thrown value into a JevProviderError.
 *
 * A failure with an HTTP status is retryable when the status says so (see
 * `isRetryableStatus`). A failure WITHOUT a status is only retryable when it
 * is a known transport failure (network, timeout, abort) - an unknown error
 * is most likely a bug in our own code and must not disappear behind a
 * fallback to another provider.
 */
export function toProviderError(error, provider) {
    if (error instanceof JevProviderError)
        return error;
    const status = extractStatus(error);
    const message = error instanceof Error ? error.message : String(error);
    return new JevProviderError(`${provider} provider failed: ${message}`, {
        provider,
        status,
        retryable: status === undefined ? isTransportError(error) : isRetryableStatus(status),
        cause: error,
    });
}
//# sourceMappingURL=provider-error.js.map
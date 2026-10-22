/**
 * Relay endpoint resolution.
 *
 * Resolves the relay WebSocket URL and the auth token from the SAME sources
 * the relay server uses (see scripts/unified-webhook-server.ts), so a client
 * and the server always agree:
 *
 *   URL:   RELAY_WS_URL env -> keys/relay-ws-url.txt -> derived from keys/telegram-webhook-url.txt
 *   Token: RELAY_AUTH_TOKEN env -> keys/relay-auth-token.txt -> keys/telegram-webhook-secret.txt
 *
 * The token value is never logged: only the NAME of the source it came from.
 */
/** Environment variables consulted by the resolver. */
export interface RelayEndpointEnv {
    RELAY_WS_URL?: string;
    RELAY_AUTH_TOKEN?: string;
}
/** Result of a relay endpoint resolution. */
export interface RelayEndpointResolution {
    /** WebSocket URL, or null when it could not be resolved. */
    url: string | null;
    /** Where the URL came from (e.g. "env RELAY_WS_URL"). Never contains a secret. */
    urlSource: string | null;
    /** Auth token, or null when it could not be resolved. */
    token: string | null;
    /** Where the token came from (e.g. "keys/telegram-webhook-secret.txt"). Never contains the token. */
    tokenSource: string | null;
    /** Human readable description of what is missing (never contains a token). */
    missing: string[];
    /** Human readable caveats about the resolved endpoint (never contains a token). */
    notes: string[];
}
/** Options for {@link resolveRelayEndpoint}. */
export interface ResolveRelayEndpointOptions {
    /** Environment to read (defaults to process.env). */
    env?: RelayEndpointEnv;
    /** Directory holding the key files (e.g. ~/.pi-harness-runtime/keys). */
    keysDir: string;
    /** Optional file reader override (used by the tests). */
    readFile?: (path: string) => string | undefined;
}
/** Source names, in the order they are consulted. */
export declare const RELAY_URL_SOURCES: readonly ["env RELAY_WS_URL", "keys/relay-ws-url.txt", "keys/telegram-webhook-url.txt (derived)"];
export declare const RELAY_TOKEN_SOURCES: readonly ["env RELAY_AUTH_TOKEN", "keys/relay-auth-token.txt", "keys/telegram-webhook-secret.txt"];
/**
 * The token sources are the SAME chain the relay server uses, so the client
 * and the server can never disagree about the credential.
 *
 * Note: `keys/telegram-webhook-secret.txt` is also the secret the Telegram
 * webhook expects in its `x-telegram-bot-api-secret-token` header. Sharing it
 * with the WebSocket relay widens the blast radius of that secret - put a
 * dedicated token in `keys/relay-auth-token.txt` (it is preferred) when the
 * relay and the webhook do not have to share one.
 *
 * The Telegram webhook secret itself may also come from the environment
 * variable TELEGRAM_WEBHOOK_SECRET; that variable belongs to the HTTP
 * webhook, not to the relay, and is therefore not part of this chain.
 */
/**
 * Derive the relay WebSocket URL from the Telegram webhook URL.
 *
 * The derivation keeps the host (and port) of the webhook URL and replaces the
 * path with /ws, because the relay is exposed on the same origin as the
 * webhook:
 *
 *   https://webhook.bunchee.online/telegram -> wss://webhook.bunchee.online/ws
 *
 * That only works when the origin serves /ws, i.e. behind the reverse proxy
 * that maps /ws to the relay port (nginx: location /ws -> 127.0.0.1:8444).
 * When the webhook URL addresses the application DIRECTLY, the relay listens
 * on WS_PORT (default 8444), not on the HTTP port - use RELAY_WS_URL or
 * keys/relay-ws-url.txt for that setup.
 */
export declare function deriveRelayWsUrl(webhookUrl: string): string | null;
/**
 * True when the value looks like a WebSocket URL.
 *
 * Credentials ("wss://user:pass@host") and query strings are rejected: the
 * resolved URL is written to the log, and neither belongs there.
 */
export declare function isRelayWsUrl(value: string): boolean;
/**
 * Resolve the relay WebSocket URL and auth token.
 *
 * The first non-empty source wins. A blank file counts as missing (an empty
 * value is a configuration mistake, not a valid endpoint). A source that holds
 * a value which was REJECTED is reported in `missing` so the operator can see
 * why the resolver moved on.
 */
export declare function resolveRelayEndpoint(options: ResolveRelayEndpointOptions): RelayEndpointResolution;
/**
 * Log-safe description of a resolution (contains no token value).
 */
export declare function describeRelayEndpoint(resolution: RelayEndpointResolution): string;

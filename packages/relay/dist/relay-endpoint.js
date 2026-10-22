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
import { readFileSync } from "node:fs";
import { join } from "node:path";
/** Source names, in the order they are consulted. */
export const RELAY_URL_SOURCES = [
    "env RELAY_WS_URL",
    "keys/relay-ws-url.txt",
    "keys/telegram-webhook-url.txt (derived)",
];
export const RELAY_TOKEN_SOURCES = [
    "env RELAY_AUTH_TOKEN",
    "keys/relay-auth-token.txt",
    "keys/telegram-webhook-secret.txt",
];
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
export function deriveRelayWsUrl(webhookUrl) {
    const trimmed = webhookUrl?.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = new URL(trimmed);
        if (!parsed.host)
            return null;
        const secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
        const scheme = secure ? "wss:" : "ws:";
        return `${scheme}//${parsed.host}/ws`;
    }
    catch {
        return null;
    }
}
/**
 * True when the value looks like a WebSocket URL.
 *
 * Credentials ("wss://user:pass@host") and query strings are rejected: the
 * resolved URL is written to the log, and neither belongs there.
 */
export function isRelayWsUrl(value) {
    const trimmed = value?.trim() ?? "";
    if (!/^wss?:\/\//i.test(trimmed))
        return false;
    if (trimmed.includes("@") || trimmed.includes("?"))
        return false;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
            return false;
        return parsed.host.length > 0;
    }
    catch {
        return false;
    }
}
function defaultReadFile(path) {
    try {
        return readFileSync(path, "utf-8");
    }
    catch {
        return undefined;
    }
}
/** Host of a URL, or an empty string when it cannot be parsed. */
function hostOf(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return "";
    }
}
/** True for hosts that address the machine itself. */
function isLoopbackHost(host) {
    const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
    return name === "127.0.0.1" || name === "localhost" || name === "::1" || name.startsWith("127.");
}
/**
 * Transport warnings for a resolved URL.
 *
 * A plaintext ws:// URL to a remote host sends the auth token in cleartext.
 */
function transportNotes(url) {
    if (!url.toLowerCase().startsWith("ws://"))
        return [];
    if (isLoopbackHost(hostOf(url)))
        return [];
    return [
        "the relay url is plaintext (ws://) for a remote host - the auth token is sent unencrypted, use wss://",
    ];
}
/**
 * Resolve the WebSocket URL: env -> dedicated key file -> derived from the
 * telegram webhook url. The first usable source wins; a source that holds a
 * rejected value is reported so the operator can see why it was skipped.
 */
function resolveUrl(env, readKey) {
    const rejected = [];
    const notes = [];
    const envUrl = env.RELAY_WS_URL?.trim();
    if (envUrl) {
        if (isRelayWsUrl(envUrl)) {
            notes.push(...transportNotes(envUrl));
            return { url: envUrl, source: "env RELAY_WS_URL", rejected, notes };
        }
        rejected.push("env RELAY_WS_URL (not a ws:// or wss:// URL)");
    }
    const fileUrl = readKey("relay-ws-url.txt");
    if (fileUrl) {
        if (isRelayWsUrl(fileUrl)) {
            notes.push(...transportNotes(fileUrl));
            return { url: fileUrl, source: "keys/relay-ws-url.txt", rejected, notes };
        }
        rejected.push("keys/relay-ws-url.txt (not a ws:// or wss:// URL)");
    }
    const webhookUrl = readKey("telegram-webhook-url.txt");
    const derived = webhookUrl ? deriveRelayWsUrl(webhookUrl) : null;
    if (derived) {
        if (isLoopbackHost(hostOf(derived))) {
            notes.push("derived url points at a loopback host: the relay listens on WS_PORT (default 8444), not on the webhook port - set RELAY_WS_URL or keys/relay-ws-url.txt");
        }
        notes.push(...transportNotes(derived));
        return { url: derived, source: "keys/telegram-webhook-url.txt (derived)", rejected, notes };
    }
    if (webhookUrl) {
        rejected.push("keys/telegram-webhook-url.txt (no ws:// or wss:// URL could be derived)");
    }
    return { url: null, source: null, rejected, notes };
}
/** Resolve the auth token: env -> dedicated key file -> webhook secret. */
function resolveToken(env, readKey) {
    const envToken = env.RELAY_AUTH_TOKEN?.trim();
    if (envToken) {
        return { token: envToken, source: "env RELAY_AUTH_TOKEN" };
    }
    const fileToken = readKey("relay-auth-token.txt");
    if (fileToken) {
        return { token: fileToken, source: "keys/relay-auth-token.txt" };
    }
    const secret = readKey("telegram-webhook-secret.txt");
    if (secret) {
        return { token: secret, source: "keys/telegram-webhook-secret.txt" };
    }
    return { token: null, source: null };
}
/**
 * Resolve the relay WebSocket URL and auth token.
 *
 * The first non-empty source wins. A blank file counts as missing (an empty
 * value is a configuration mistake, not a valid endpoint). A source that holds
 * a value which was REJECTED is reported in `missing` so the operator can see
 * why the resolver moved on.
 */
export function resolveRelayEndpoint(options) {
    const env = options.env ?? process.env;
    const read = options.readFile ?? defaultReadFile;
    const readKey = (name) => {
        try {
            const raw = read(join(options.keysDir, name));
            const value = raw?.trim();
            return value ? value : undefined;
        }
        catch {
            // An unreadable key file is treated as absent - the source list in
            // `missing` tells the operator where to look.
            return undefined;
        }
    };
    const urlResolution = resolveUrl(env, readKey);
    const tokenResolution = resolveToken(env, readKey);
    const missing = [];
    if (!urlResolution.url) {
        missing.push(`url not resolved (looked at ${RELAY_URL_SOURCES.join(", ")})`);
    }
    if (!tokenResolution.token) {
        missing.push(`token not resolved (looked at ${RELAY_TOKEN_SOURCES.join(", ")})`);
    }
    for (const reason of urlResolution.rejected) {
        missing.push(`rejected source: ${reason}`);
    }
    return {
        url: urlResolution.url,
        urlSource: urlResolution.source,
        token: tokenResolution.token,
        tokenSource: tokenResolution.source,
        missing,
        notes: urlResolution.notes,
    };
}
/**
 * Log-safe description of a resolution (contains no token value).
 */
export function describeRelayEndpoint(resolution) {
    const parts = [];
    parts.push(resolution.url ? `url from ${resolution.urlSource}` : "url NOT resolved");
    parts.push(resolution.token ? `token from ${resolution.tokenSource}` : "token NOT resolved");
    let description = parts.join(", ");
    if (resolution.notes.length > 0) {
        description += ` (${resolution.notes.join("; ")})`;
    }
    return description;
}

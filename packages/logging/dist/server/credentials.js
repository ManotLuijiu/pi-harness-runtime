/**
 * Scoped ingest credentials.
 *
 * The tenant is derived from the credential, never from the request body:
 * a client cannot claim a tenant it does not own.
 *
 * Two credential shapes are supported:
 *
 *   1. A credential store (`log-ingest-credentials.json`) with one entry per
 *      installation. Tokens are stored as SHA-256 hashes, so the file is safe
 *      to keep in the key directory and a token can be revoked by removing
 *      or revoking its entry.
 *   2. A single shared token (`LOG_INGEST_TOKEN` or the
 *      `log-ingest-token.txt` key file) for a single-tenant deployment. It
 *      maps to the tenant `LOG_INGEST_TENANT` (default `default`).
 *
 * When neither is configured the store is NOT configured: the ingest
 * endpoint then refuses every write (fail closed) instead of accepting
 * anonymous batches.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const DEFAULT_TENANT_ID = "default";
export const LOG_WRITE_SCOPE = "logs:write";
export const LOG_READ_SCOPE = "logs:read";
/** Hash a token the way the store does. */
export function hashToken(token) {
    return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}
function safeEqual(a, b) {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length)
        return false;
    return timingSafeEqual(left, right);
}
function readFileTrimmed(path) {
    try {
        if (!existsSync(path))
            return undefined;
        const value = readFileSync(path, "utf8").trim();
        return value.length > 0 ? value : undefined;
    }
    catch {
        return undefined;
    }
}
export class LogCredentialStore {
    credentials;
    shared;
    constructor(credentials, shared) {
        this.credentials = credentials;
        this.shared = shared;
    }
    /**
     * Load the store from the credential file and the shared token.
     *
     * A malformed credential file is ignored (and reported through
     * `loadErrors`), never fatal: the endpoint then fails closed.
     */
    static load(options = {}) {
        const env = options.env ?? process.env;
        const keysDir = options.keysDir ?? join(homedir(), ".pi-harness-runtime", "keys");
        const path = options.path ?? join(keysDir, "log-ingest-credentials.json");
        const credentials = [];
        try {
            if (existsSync(path)) {
                const parsed = JSON.parse(readFileSync(path, "utf8"));
                if (Array.isArray(parsed?.credentials)) {
                    for (const entry of parsed.credentials) {
                        if (entry &&
                            typeof entry.id === "string" &&
                            typeof entry.tenantId === "string" &&
                            typeof entry.tokenHash === "string") {
                            credentials.push({
                                ...entry,
                                scopes: Array.isArray(entry.scopes) ? entry.scopes : [LOG_WRITE_SCOPE],
                                createdAt: entry.createdAt ?? new Date(0).toISOString(),
                                revokedAt: entry.revokedAt ?? null,
                            });
                        }
                    }
                }
            }
        }
        catch {
            // A broken file must not open the door: the store stays unconfigured.
        }
        const sharedToken = env.LOG_INGEST_TOKEN ?? readFileTrimmed(join(keysDir, "log-ingest-token.txt"));
        const shared = sharedToken
            ? { token: sharedToken, tenantId: env.LOG_INGEST_TENANT ?? DEFAULT_TENANT_ID }
            : undefined;
        return new LogCredentialStore(credentials, shared);
    }
    /** True when at least one usable credential exists. */
    get configured() {
        return (this.shared !== undefined ||
            this.credentials.some((credential) => !credential.revokedAt));
    }
    /** The credentials without their token hashes. */
    list() {
        return this.credentials.map(({ tokenHash: _tokenHash, ...rest }) => rest);
    }
    /**
     * Authenticate a presented token.
     *
     * Returns null when the token is missing, unknown or revoked.
     */
    authenticate(token) {
        if (!token)
            return null;
        if (this.shared && safeEqual(hashToken(token), hashToken(this.shared.token))) {
            return {
                credentialId: "shared",
                tenantId: this.shared.tenantId,
                scopes: [LOG_WRITE_SCOPE, LOG_READ_SCOPE],
                shared: true,
            };
        }
        const presented = hashToken(token);
        for (const credential of this.credentials) {
            if (credential.revokedAt)
                continue;
            if (!safeEqual(presented, credential.tokenHash))
                continue;
            return {
                credentialId: credential.id,
                tenantId: credential.tenantId,
                scopes: credential.scopes,
                shared: false,
            };
        }
        return null;
    }
}
/**
 * Extract the bearer token from an Authorization header.
 */
export function readBearerToken(header) {
    if (!header)
        return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : undefined;
}
//# sourceMappingURL=credentials.js.map
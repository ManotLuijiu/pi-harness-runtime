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
export interface LogCredential {
    /** Stable id of the credential (safe to log). */
    id: string;
    /** The tenant this credential may write for. */
    tenantId: string;
    /** Human readable label, e.g. "laptop". */
    label?: string;
    /** Allowed scopes, e.g. ["logs:write", "logs:read"]. */
    scopes: string[];
    /** SHA-256 hash of the token, prefixed with the algorithm. */
    tokenHash: string;
    createdAt: string;
    /** Set when the credential was revoked. */
    revokedAt?: string | null;
}
export interface CredentialFile {
    credentials: LogCredential[];
}
export interface AuthenticatedCredential {
    credentialId: string;
    tenantId: string;
    scopes: string[];
    /** True when the credential came from the shared token. */
    shared: boolean;
}
export interface LogCredentialStoreOptions {
    /** Path of the credential store file. */
    path?: string;
    /** Environment used for the shared token. */
    env?: Record<string, string | undefined>;
    /** Directory holding the key files. */
    keysDir?: string;
}
export declare const DEFAULT_TENANT_ID = "default";
export declare const LOG_WRITE_SCOPE = "logs:write";
export declare const LOG_READ_SCOPE = "logs:read";
/** Hash a token the way the store does. */
export declare function hashToken(token: string): string;
export declare class LogCredentialStore {
    private readonly credentials;
    private readonly shared;
    private constructor();
    /**
     * Load the store from the credential file and the shared token.
     *
     * A malformed credential file is ignored (and reported through
     * `loadErrors`), never fatal: the endpoint then fails closed.
     */
    static load(options?: LogCredentialStoreOptions): LogCredentialStore;
    /** True when at least one usable credential exists. */
    get configured(): boolean;
    /** The credentials without their token hashes. */
    list(): Omit<LogCredential, "tokenHash">[];
    /**
     * Authenticate a presented token.
     *
     * Returns null when the token is missing, unknown or revoked.
     */
    authenticate(token: string | undefined): AuthenticatedCredential | null;
}
/**
 * Extract the bearer token from an Authorization header.
 */
export declare function readBearerToken(header: string | undefined): string | undefined;
//# sourceMappingURL=credentials.d.ts.map
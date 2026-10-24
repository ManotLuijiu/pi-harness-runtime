/**
 * Stable installation identity.
 *
 * One random id per local install. It is created on first use, persisted
 * under `~/.pi-harness-runtime/installation-id.txt` and sent with every
 * batch so the server can tell two machines of the same user apart.
 *
 * The id is deliberately opaque:
 *   - it never contains the hostname, the user name or a workspace path,
 *   - it is not derived from anything that could identify a person,
 *   - it is never used as an identity on the server (the tenant comes from
 *     the authenticated credential).
 */
export declare const INSTALLATION_ID_FILE = "installation-id.txt";
/** Default location of the installation id file. */
export declare function defaultInstallationIdPath(): string;
/** True when the value looks like a uuid (the only shape we write). */
export declare function isValidInstallationId(value: string): boolean;
export interface ResolveInstallationIdOptions {
    /** File the id is read from and written to. */
    path?: string;
    /** Id factory (tests). */
    generate?: () => string;
}
/**
 * Resolve the installation id: read it when it exists, create it otherwise.
 *
 * A failed read or write never throws - the id is best effort metadata and
 * must not break logging.
 */
export declare function resolveInstallationId(options?: ResolveInstallationIdOptions): string;
//# sourceMappingURL=installation.d.ts.map
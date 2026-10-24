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
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export const INSTALLATION_ID_FILE = "installation-id.txt";
/** Default location of the installation id file. */
export function defaultInstallationIdPath() {
    return join(homedir(), ".pi-harness-runtime", INSTALLATION_ID_FILE);
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** True when the value looks like a uuid (the only shape we write). */
export function isValidInstallationId(value) {
    return UUID_PATTERN.test(value.trim());
}
/**
 * Resolve the installation id: read it when it exists, create it otherwise.
 *
 * A failed read or write never throws - the id is best effort metadata and
 * must not break logging.
 */
export function resolveInstallationId(options = {}) {
    const path = options.path ?? defaultInstallationIdPath();
    const generate = options.generate ?? randomUUID;
    try {
        if (existsSync(path)) {
            const existing = readFileSync(path, "utf8").trim();
            if (isValidInstallationId(existing))
                return existing;
        }
    }
    catch {
        // Fall through and create a new id.
    }
    let id;
    try {
        id = generate();
    }
    catch {
        id = randomUUID();
    }
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${id}\n`, { mode: 0o600 });
        chmodSync(path, 0o600);
    }
    catch {
        // The id still works for this process even when it cannot be persisted.
    }
    return id;
}
//# sourceMappingURL=installation.js.map
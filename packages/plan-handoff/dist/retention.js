/**
 * The handoffs that wait for a recipient.
 *
 * A handoff whose recipient does not exist yet is not delivered to another
 * project and is not thrown away. It is retained until a Pi instance of the
 * workspace appears, until the user cancels it, or until it expires.
 *
 * The rebinding of a retained handoff to a later instance is explicit and
 * recorded: the agent id of the recipient is never substituted silently.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { canonicalizePath } from "./workspace.js";
/**
 * How long a retained handoff waits for a recipient.
 */
export const DEFAULT_HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
/**
 * The store of the retained handoffs.
 *
 * Every handoff owns one file of the store, so two senders never overwrite
 * each other. The write of a file is atomic.
 */
export class PendingHandoffStore {
    directory;
    retentionMs;
    constructor(directory, options = {}) {
        this.directory = directory;
        this.retentionMs = options.retentionMs ?? DEFAULT_HANDOFF_RETENTION_MS;
    }
    /**
     * The retained handoffs, expired ones included.
     */
    list() {
        let names;
        try {
            names = readdirSync(this.directory);
        }
        catch {
            return [];
        }
        const handoffs = [];
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            try {
                const parsed = JSON.parse(readFileSync(join(this.directory, name), "utf8"));
                if (!isPendingHandoff(parsed))
                    continue;
                handoffs.push(parsed);
            }
            catch {
                continue;
            }
        }
        return handoffs;
    }
    /**
     * The handoffs that wait for a recipient and did not expire.
     */
    awaiting(now = Date.now()) {
        return this.list().filter((handoff) => handoff.state === "awaiting-recipient" && handoff.expiresAt > now);
    }
    /**
     * Retain a handoff.
     */
    retain(handoff) {
        mkdirSync(this.directory, { recursive: true });
        const target = join(this.directory, `${handoff.id}.json`);
        const temporary = `${target}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(handoff, null, 2)}\n`, {
            mode: 0o600,
        });
        renameSync(temporary, target);
    }
    /**
     * Retain a handoff with the expiry of the store.
     *
     * The caller names the handoff and the store names its expiry: the
     * retention of the deployment is one number, and it is not written
     * twice in two callers.
     */
    retainWithExpiry(handoff, now = Date.now()) {
        const retained = {
            ...handoff,
            expiresAt: now + this.retentionMs,
        };
        this.retain(retained);
        return retained;
    }
    /**
     * Claim a retained handoff for an instance.
     *
     * The claim is explicit: the caller names the instance the handoff goes
     * to, and the state of the handoff records it.
     */
    claim(id, registration, now = Date.now()) {
        const handoff = this.read(id);
        if (!handoff)
            return undefined;
        if (handoff.state !== "awaiting-recipient")
            return undefined;
        if (handoff.expiresAt <= now)
            return undefined;
        const claimed = {
            ...handoff,
            state: "claimed",
            requestedAgentId: registration.agentId,
            requestedSessionId: registration.sessionId,
        };
        this.retain(claimed);
        return claimed;
    }
    /**
     * Cancel a retained handoff.
     */
    cancel(id) {
        const handoff = this.read(id);
        if (!handoff)
            return false;
        this.retain({ ...handoff, state: "cancelled" });
        return true;
    }
    /**
     * Remove the handoffs that expired.
     */
    prune(now = Date.now()) {
        let removed = 0;
        for (const handoff of this.list()) {
            if (handoff.expiresAt > now)
                continue;
            try {
                unlinkSync(join(this.directory, `${handoff.id}.json`));
                removed += 1;
            }
            catch {
                continue;
            }
        }
        return removed;
    }
    /**
     * Read one handoff.
     */
    read(id) {
        try {
            const parsed = JSON.parse(readFileSync(join(this.directory, `${id}.json`), "utf8"));
            return isPendingHandoff(parsed) ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    }
}
/**
 * Whether a value is a retained handoff.
 */
function isPendingHandoff(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.id === "string" &&
        typeof candidate.correlationId === "string" &&
        typeof candidate.workspace === "string" &&
        typeof candidate.state === "string" &&
        typeof candidate.createdAt === "number" &&
        typeof candidate.expiresAt === "number");
}
/**
 * The handoffs of a workspace that wait for a recipient.
 */
export function awaitingInWorkspace(store, workspace, now = Date.now()) {
    const target = canonicalizePath(workspace);
    return store
        .awaiting(now)
        .filter((handoff) => canonicalizePath(handoff.workspace) === target);
}
//# sourceMappingURL=retention.js.map
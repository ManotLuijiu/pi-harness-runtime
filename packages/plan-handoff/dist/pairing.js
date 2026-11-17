/**
 * The pairings of a workspace.
 *
 * A pairing remembers which instance of a workspace the user chose before.
 * It is only a hint for the router: the router still checks that the paired
 * instance is alive and that it runs in the same workspace. A pairing of a
 * session that ended, or of a workspace that changed, never decides.
 *
 * The pairing is keyed by the canonical workspace, so a symlink of the same
 * directory finds the same pairing and two worktrees of one repository keep
 * their own pairings.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
import { canonicalizePath } from "./workspace.js";
/**
 * The store of the pairings.
 */
export class PairingStore {
    path;
    constructor(path) {
        this.path = path;
    }
    /**
     * The pairing of a workspace, when there is one.
     */
    read(workspace) {
        const pairings = this.readAll();
        return pairings[canonicalizePath(workspace)];
    }
    /**
     * Remember the pairing of a workspace.
     */
    write(workspace, pairing) {
        const pairings = this.readAll();
        pairings[canonicalizePath(workspace)] = pairing;
        this.writeAll(pairings);
    }
    /**
     * Forget the pairing of a workspace.
     */
    forget(workspace) {
        const pairings = this.readAll();
        delete pairings[canonicalizePath(workspace)];
        this.writeAll(pairings);
    }
    /**
     * Every pairing of the store.
     */
    readAll() {
        try {
            const parsed = JSON.parse(readFileSync(this.path, "utf8"));
            if (!parsed || typeof parsed.pairings !== "object" || parsed.pairings === null) {
                return {};
            }
            const result = {};
            for (const [workspace, value] of Object.entries(parsed.pairings)) {
                if (!isPairing(value))
                    continue;
                result[workspace] = value;
            }
            return result;
        }
        catch {
            return {};
        }
    }
    /**
     * Write the store atomically.
     */
    writeAll(pairings) {
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify({ pairings }, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, this.path);
    }
}
/**
 * Whether a value is a pairing.
 */
function isPairing(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.agentId === "string" &&
        typeof candidate.pairedAt === "number");
}
//# sourceMappingURL=pairing.js.map
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
/**
 * One pairing.
 */
export interface Pairing {
    /** The agent id of the paired instance. */
    agentId: string;
    /** The session of the paired instance, when it was recorded. */
    sessionId?: string;
    /** When the pairing was made. */
    pairedAt: number;
}
/**
 * The store of the pairings.
 */
export declare class PairingStore {
    private readonly path;
    constructor(path: string);
    /**
     * The pairing of a workspace, when there is one.
     */
    read(workspace: string): Pairing | undefined;
    /**
     * Remember the pairing of a workspace.
     */
    write(workspace: string, pairing: Pairing): void;
    /**
     * Forget the pairing of a workspace.
     */
    forget(workspace: string): void;
    /**
     * Every pairing of the store.
     */
    readAll(): Record<string, Pairing>;
    /**
     * Write the store atomically.
     */
    private writeAll;
}
//# sourceMappingURL=pairing.d.ts.map
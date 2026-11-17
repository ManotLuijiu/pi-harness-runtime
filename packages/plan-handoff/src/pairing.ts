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

import {
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { canonicalizePath } from "./workspace.js";

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
export class PairingStore {
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
	}

	/**
	 * The pairing of a workspace, when there is one.
	 */
	read(workspace: string): Pairing | undefined {
		const pairings = this.readAll();
		return pairings[canonicalizePath(workspace)];
	}

	/**
	 * Remember the pairing of a workspace.
	 */
	write(workspace: string, pairing: Pairing): void {
		const pairings = this.readAll();
		pairings[canonicalizePath(workspace)] = pairing;
		this.writeAll(pairings);
	}

	/**
	 * Forget the pairing of a workspace.
	 */
	forget(workspace: string): void {
		const pairings = this.readAll();
		delete pairings[canonicalizePath(workspace)];
		this.writeAll(pairings);
	}

	/**
	 * Every pairing of the store.
	 */
	readAll(): Record<string, Pairing> {
		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8")) as {
				pairings?: unknown;
			};
			if (!parsed || typeof parsed.pairings !== "object" || parsed.pairings === null) {
				return {};
			}
			const result: Record<string, Pairing> = {};
			for (const [workspace, value] of Object.entries(
				parsed.pairings as Record<string, unknown>,
			)) {
				if (!isPairing(value)) continue;
				result[workspace] = value;
			}
			return result;
		} catch {
			return {};
		}
	}

	/**
	 * Write the store atomically.
	 */
	private writeAll(pairings: Record<string, Pairing>): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.tmp`;
		writeFileSync(
			temporary,
			`${JSON.stringify({ pairings }, null, 2)}\n`,
			{ mode: 0o600 },
		);
		renameSync(temporary, this.path);
	}
}

/**
 * Whether a value is a pairing.
 */
function isPairing(value: unknown): value is Pairing {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<Pairing>;
	return (
		typeof candidate.agentId === "string" &&
		typeof candidate.pairedAt === "number"
	);
}

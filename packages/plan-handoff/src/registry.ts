/**
 * The registration of the live Pi instances.
 *
 * A sender finds its recipient through this store: every running Pi
 * instance writes a registration with a runtime-generated agent id, its
 * session, an instance generation, the canonical workspace, the host and the
 * process, a descriptive model label, its busy and paused state and a
 * heartbeat.
 *
 * The model label is descriptive. It is never the identity: two instances
 * may run the same model, and a process id can be reused. The identity is
 * the agent id, and the liveness is the heartbeat.
 *
 * Every instance owns one file of the store. Two instances that start at the
 * same moment therefore never overwrite each other: the write of one file
 * cannot lose the registration of the other.
 */

import {
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * One registered Pi instance.
 */
export interface AgentRegistration {
	/** The runtime-generated identity of the instance. */
	agentId: string;
	/** The session of the instance. */
	sessionId: string;
	/**
	 * The generation of the instance.
	 *
	 * A restart is a new generation. The generation rises with every start
	 * of the instance, so a message that was addressed to the previous
	 * generation is refused instead of delivered to a new session.
	 */
	generation: number;
	/** The canonical workspace of the instance. */
	workspace: string;
	/** The host the instance runs on. */
	host: string;
	/** The process of the instance. A process id alone proves nothing. */
	pid: number;
	/** The model of the instance. Descriptive, never an identity. */
	modelLabel?: string;
	/** True while the instance works on something. */
	busy?: boolean;
	/** True while the user paused the instance. */
	paused?: boolean;
	/** When the instance started. */
	startedAt: number;
	/** When the instance last wrote its heartbeat. */
	heartbeatAt: number;
}

/**
 * How long a registration lives without a heartbeat.
 */
export const DEFAULT_HEARTBEAT_TTL_MS = 60_000;

/**
 * Whether a value is a registration.
 *
 * The content of the store comes from a file, so it is checked before it
 * decides anything.
 */
function isAgentRegistration(value: unknown): value is AgentRegistration {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<AgentRegistration>;
	return (
		typeof candidate.agentId === "string" &&
		typeof candidate.sessionId === "string" &&
		typeof candidate.workspace === "string" &&
		typeof candidate.heartbeatAt === "number"
	);
}

/**
 * The store of the registrations.
 *
 * The store is one directory that every instance of the user shares. The
 * write of one registration is atomic: a reader never sees half a file, and
 * a crash in the middle of a write leaves the previous content intact.
 */
export class RegistrationStore {
	private readonly directory: string;
	private readonly ttlMs: number;
	private readonly now: () => number;

	constructor(
		directory: string,
		options: { ttlMs?: number; now?: () => number } = {},
	) {
		this.directory = directory;
		this.ttlMs = options.ttlMs ?? DEFAULT_HEARTBEAT_TTL_MS;
		this.now = options.now ?? (() => Date.now());
	}

	/**
	 * The registrations of the store, expired ones included.
	 *
	 * A store that cannot be read is an empty store: the sender then finds
	 * no recipient and retains the plan, which is the safe answer.
	 */
	list(): AgentRegistration[] {
		let names: string[];
		try {
			names = readdirSync(this.directory);
		} catch {
			return [];
		}
		const registrations: AgentRegistration[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				const parsed = JSON.parse(
					readFileSync(join(this.directory, name), "utf8"),
				) as unknown;
				if (!isAgentRegistration(parsed)) continue;
				registrations.push(parsed);
			} catch {
				// A file that cannot be read is a registration that is not
				// there. It never decides the routing.
				continue;
			}
		}
		return registrations;
	}

	/**
	 * The registrations that are still alive.
	 *
	 * A registration without a heartbeat inside the window belongs to an
	 * instance that died or was paused for longer than the window. Its
	 * process id may already belong to another process, so the heartbeat is
	 * the proof of life.
	 */
	live(now: number = this.now()): AgentRegistration[] {
		return this.list().filter(
			(entry) => now - entry.heartbeatAt <= this.ttlMs,
		);
	}

	/**
	 * Write a registration, replacing the one with the same agent id.
	 */
	upsert(registration: AgentRegistration): void {
		mkdirSync(this.directory, { recursive: true });
		const target = join(this.directory, `${registration.agentId}.json`);
		const temporary = `${target}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(registration, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, target);
	}

	/**
	 * Remove a registration.
	 */
	remove(agentId: string): void {
		try {
			unlinkSync(join(this.directory, `${agentId}.json`));
		} catch {
			// A registration that is not there is already removed.
		}
	}
}

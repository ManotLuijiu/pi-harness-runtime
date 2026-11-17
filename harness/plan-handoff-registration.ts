/**
 * The registration of the running Pi instance.
 *
 * The extension registers the instance it runs in, so a sender can find the
 * recipient of a plan in the same workspace. The registration proves that
 * the instance is alive and where it works. It grants no permission: the
 * recipient still validates the message before it queues anything.
 *
 * The model label of the registration is descriptive. The identity is the
 * agent id, and the liveness is the heartbeat.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import {
	RegistrationStore,
	detectWorkspace,
	type AgentRegistration,
} from "../packages/plan-handoff/dist/index.js";

/**
 * The directory of the registrations.
 */
export const PLAN_HANDOFF_STORE_DIR = join(
	homedir(),
	".pi-harness-runtime",
	"plan-handoff",
	"agents",
);

/**
 * The file that counts the generations of the instances.
 */
export const PLAN_HANDOFF_GENERATION_FILE = join(
	homedir(),
	".pi-harness-runtime",
	"plan-handoff",
	"generation.json",
);

/**
 * How often the instance writes its heartbeat.
 */
export const PLAN_HANDOFF_HEARTBEAT_MS = 20_000;

/**
 * The registration of a running instance.
 */
export interface PlanHandoffAgent {
	/** The runtime-generated identity of the instance. */
	agentId: string;
	/** The session of the instance. */
	sessionId: string;
	/** The generation of the instance: a restart raises it. */
	generation: number;
	/** The store the registration lives in. */
	store: RegistrationStore;
	/**
	 * The registration of this instance.
	 *
	 * The receiver of the plans reads the mailbox of the instance with
	 * this identity, so the receiver and the registration always agree on
	 * which instance they are.
	 */
	registration: AgentRegistration;
	/** Remove the registration and stop the heartbeat. */
	stop: () => void;
}

/**
 * The options of the registration.
 */
export interface StartPlanHandoffOptions {
	/** The session of the instance. */
	sessionId: string;
	/** The workspace of the instance. The working directory by default. */
	workspace?: string;
	/** The host of the instance. */
	host?: string;
	/** The process of the instance. */
	pid?: number;
	/** The model of the instance. Descriptive, never an identity. */
	modelLabel?: string;
	/** The clock of the heartbeat. */
	now?: () => number;
	/** The store of the registrations. */
	store?: RegistrationStore;
	/** The file that counts the generations. */
	generationFile?: string;
	/** How often the heartbeat is written. */
	heartbeatMs?: number;
}

/**
 * The next generation of the instance.
 *
 * The counter survives the end of a session, so a restart of the same
 * session raises the generation instead of reusing it.
 */
function nextGeneration(file: string): number {
	let current = 0;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			generation?: unknown;
		};
		if (typeof parsed?.generation === "number") current = parsed.generation;
	} catch {
		// The counter does not exist yet: the first instance starts at one.
		current = 0;
	}
	const next = current + 1;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify({ generation: next }, null, 2)}\n`, {
			mode: 0o600,
		});
	} catch {
		// A counter that cannot be written still yields a generation: the
		// identity of the instance is the agent id, and the generation only
		// refuses a message of a previous instance.
	}
	return next;
}

/**
 * Register the running instance and keep its heartbeat alive.
 *
 * The registration is removed when the instance stops. A sender that finds
 * no live registration keeps the plan and waits for an instance to appear.
 */
export function startPlanHandoffRegistration(
	options: StartPlanHandoffOptions,
): PlanHandoffAgent {
	const now = options.now ?? (() => Date.now());
	const store = options.store ?? new RegistrationStore(PLAN_HANDOFF_STORE_DIR, { now });
	const agentId = randomUUID();
	const generation = nextGeneration(
		options.generationFile ?? PLAN_HANDOFF_GENERATION_FILE,
	);
	const workspace = detectWorkspace(options.workspace ?? process.cwd());
	const host = options.host ?? hostname();
	const pid = options.pid ?? process.pid;

	// The registration of this instance. The receiver of the plans reads
	// the mailbox of the instance with this identity.
	const registration: AgentRegistration = {
		agentId,
		sessionId: options.sessionId,
		generation,
		workspace: workspace.path,
		host,
		pid,
		modelLabel: options.modelLabel,
		busy: false,
		paused: false,
		startedAt: now(),
		heartbeatAt: now(),
	};

	// The heartbeat raises the beat of the same registration: the start of
	// the instance does not change with every beat.
	const write = (): void => {
		registration.heartbeatAt = now();
		store.upsert(registration);
	};

	write();
	const heartbeat = setInterval(write, options.heartbeatMs ?? PLAN_HANDOFF_HEARTBEAT_MS);
	if (typeof heartbeat.unref === "function") heartbeat.unref();

	return {
		agentId,
		sessionId: options.sessionId,
		generation,
		store,
		registration,
		stop: () => {
			clearInterval(heartbeat);
			store.remove(agentId);
		},
	};
}

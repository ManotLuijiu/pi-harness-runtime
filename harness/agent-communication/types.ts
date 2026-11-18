/**
 * The consultation of a worker of another vendor.
 *
 * The harness asks a CLI worker - Codex or Claude Code - a question and
 * gets its answer. The consultation is read-only: the worker may look at
 * the workspace, but it may not change it.
 *
 * The types of this module are the contract of the consultation. They say
 * what a request is, what a result is and which states a job can be in.
 * The state is a fact of the transport, never a guess: a failure that is
 * not understood stays a failure, and it is not called a quota problem
 * because a quota problem is a common one.
 */

/**
 * The workers the harness can consult.
 *
 * The vocabulary is closed. A caller names a target of this list, never a
 * binary: a binary name that a caller controls is a command the harness
 * would run without knowing what it does.
 */
export const CONSULT_TARGETS = ["codex", "claude"] as const;

/** A worker the harness can consult. */
export type ConsultTarget = (typeof CONSULT_TARGETS)[number];

/**
 * Is this a target the harness can consult?
 *
 * A target that is not in the vocabulary is refused: nothing runs.
 */
export function isConsultTarget(value: unknown): value is ConsultTarget {
	return (
		typeof value === "string" &&
		(CONSULT_TARGETS as readonly string[]).includes(value)
	);
}

/**
 * The states a consultation can be in.
 *
 * - `queued`: the job waits for a worker.
 * - `running`: a worker is answering.
 * - `completed`: the worker answered.
 * - `failed`: the worker failed and the reason is not understood.
 * - `cancelled`: the human (or the session) stopped the job.
 * - `timed-out`: the worker did not answer in time.
 * - `blocked-approval`: the worker asked for a permission that nobody
 *   answered. The harness never answers it: an approval of a worker is a
 *   decision of the human.
 * - `blocked-auth-or-quota`: the worker cannot run: it is not signed in,
 *   or its allowance is used up.
 */
export type ConsultStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "timed-out"
	| "blocked-approval"
	| "blocked-auth-or-quota";

/**
 * The status of a job that is over.
 *
 * A job that is over has one of these states. A job that is running does
 * not have one: it is `running` or `queued`.
 */
export const TERMINAL_CONSULT_STATUSES: ConsultStatus[] = [
	"completed",
	"failed",
	"cancelled",
	"timed-out",
	"blocked-approval",
	"blocked-auth-or-quota",
];

/**
 * Is this a state a job cannot leave?
 */
export function isTerminalConsultStatus(status: ConsultStatus): boolean {
	return TERMINAL_CONSULT_STATUSES.includes(status);
}

/**
 * The sender of a consultation.
 *
 * The sender is the runtime of the harness, never the text of the caller:
 * a worker may not pretend to be another session.
 */
export interface ConsultSender {
	/** The agent that asks. */
	agentId: string;
	/** The session that asks. */
	sessionId: string;
	/** The generation of that session. */
	generation: number;
}

/**
 * A request to a worker.
 */
export interface ConsultRequest {
	/** The id of the job. */
	jobId: string;
	/** The id that ties the answer to the request. */
	correlationId: string;
	/** The worker that is asked. */
	target: ConsultTarget;
	/** The question. */
	prompt: string;
	/** The canonical absolute path of the workspace of the worker. */
	workspace: string;
	/** How long the worker may take. */
	timeoutMs: number;
	/** When the job was created. */
	startedAt: number;
	/** Who asked. */
	sender: ConsultSender;
	/**
	 * Keep the copy of the workspace.
	 *
	 * A consult throws the copy away. The write lane needs it: the worker
	 * writes into the copy, and the harness applies the named files of the
	 * copy into the workspace itself.
	 */
	keepStaging?: boolean;
}

/**
 * The result of a consultation.
 */
export interface ConsultResult {
	/** The id of the job. */
	jobId: string;
	/** The id that ties the answer to the request. */
	correlationId: string;
	/** The worker that was asked. */
	target: ConsultTarget;
	/** The workspace of the worker. */
	workspace: string;
	/** The state of the job. */
	status: ConsultStatus;
	/**
	 * The answer of the worker.
	 *
	 * The answer is data: it is the text of another model, and it never
	 * approves anything.
	 */
	answer: string;
	/** The exit code of the worker, when it ran. */
	exitCode?: number;
	/**
	 * Was the job refused before the worker started?
	 *
	 * A refusal is not a failure: the worker never ran. A workspace that
	 * could not be copied, a worker that is not installed, an empty
	 * question - the job was refused, and the caller says so.
	 */
	refused?: boolean;
	/**
	 * The files of the workspace that the worker changed.
	 *
	 * A consultation may not change the workspace. The harness watches the
	 * tree itself, so a worker that changed something is named and not
	 * trusted.
	 */
	changedFiles?: string[];
	/**
	 * The copy of the workspace, when it was kept.
	 *
	 * The write lane reads the files that the worker wrote from the copy.
	 * A consult has no copy: it is thrown away.
	 */
	stagedPath?: string;
	/**
	 * The files that the worker wrote into the copy.
	 *
	 * The paths are relative to the copy. The write lane names the files
	 * that the worker wrote outside the files it was asked to write, and
	 * it applies nothing then.
	 */
	stagedChanges?: string[];
	/**
	 * A short reason, when there is one.
	 *
	 * The reason is bounded: it is a line for the human, not a log.
	 */
	diagnostic?: string;
	/** How long the worker took. */
	durationMs: number;
}

/**
 * The run of a worker, before it is parsed.
 *
 * The runner knows nothing about the worker: it starts a process, feeds it
 * a prompt and collects what it wrote. The adapter knows the worker and
 * reads this.
 */
export interface WorkerRun {
	/** What the worker wrote to stdout. */
	stdout: string;
	/** What the worker wrote to stderr. */
	stderr: string;
	/** The exit code of the worker, when it ran. */
	exitCode?: number;
	/** The signal that ended the worker, when a signal did. */
	signal?: string;
	/** Did the worker run out of time? */
	timedOut: boolean;
	/** Was the worker stopped on purpose? */
	cancelled: boolean;
	/** Did the worker even start? */
	spawnError?: string;
	/** Was the output cut off? */
	truncated: boolean;
	/** How long the worker took. */
	durationMs: number;
}

/**
 * The reader of one worker.
 *
 * The adapter names the worker: its binary, its flags and the way its
 * answer is read. The runner and the runtime are the same for every
 * worker.
 */
export interface ConsultAdapter {
	/** The worker this adapter is for. */
	readonly target: ConsultTarget;
	/** The binary of the worker. */
	readonly binary: string;
	/**
	 * The arguments of one consultation.
	 *
	 * The prompt goes to stdin, so it is never an argument: an argument
	 * is visible in the process list of the machine.
	 */
	readonly argv: readonly string[];
	/**
	 * The arguments of a consultation on a machine without a sandbox.
	 *
	 * The strict arguments ask the worker for nothing, and the tools of
	 * the worker need the sandbox of the operating system. A machine that
	 * cannot start that sandbox would make the worker blind with the
	 * strict arguments; the contained arguments let the worker work, and
	 * the copy of the workspace is the boundary.
	 */
	readonly fallbackArgv?: readonly string[];
	/**
	 * The environment of the worker.
	 *
	 * The environment is filtered: the worker is the user's own CLI, so
	 * it needs its own session, and it does not need the credentials of
	 * the harness.
	 */
	readonly env: Readonly<Record<string, string>>;
	/**
	 * Read the answer of the worker.
	 *
	 * The reader decides the state of the job: an answer that cannot be
	 * read is a failure, and a failure that is not understood stays a
	 * failure.
	 */
	readonly read: (run: WorkerRun) => {
		status: ConsultStatus;
		answer: string;
		diagnostic?: string;
	};
}

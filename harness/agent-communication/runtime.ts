/**
 * The runtime of the consultations.
 *
 * The harness asks a worker of another vendor a question and gets its
 * answer. The runtime owns that: it starts the worker, it watches the
 * time, it stops it when the session stops, and it keeps the state of the
 * job so the answer is a fact of the machine and not a moment of a
 * session.
 *
 * The rules of the runtime:
 *
 * - One worker per target, two workers in total. A worker that is
 *   already running is not joined by a second one.
 * - The hop limit is one. A worker may not consult another worker: the
 *   consultation is a question to a foreign model, and a foreign model
 *   that may ask again is a loop. The limit is the seam that holds this
 *   down: today the workers have no route back into the harness (no MCP
 *   servers, no tools), so no caller passes a hop and the check is a
 *   defence in depth, not a wall that is hit every day.
 * - A cancelled job owns its worker until the worker is really gone. The
 *   job is never handed to a second worker while the first one may still
 *   answer.
 * - The answer of a worker is data. It never approves a command, it never
 *   finishes a task of the harness and it never starts another worker.
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filteredEnv, runCli } from "./cli-runner.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { resolveBinary, sandboxAvailable } from "./detect.ts";
import { stageWorkspace } from "./staging.ts";
import type { StagedWorkspace } from "./staging.ts";
import { changesSince, snapshotWorkspace } from "./workspace-guard.ts";
import type { JobRecord, JobStore } from "./store.ts";
import type {
	ConsultAdapter,
	ConsultRequest,
	ConsultResult,
	ConsultSender,
	ConsultStatus,
	ConsultTarget,
} from "./types.ts";
import { isConsultTarget } from "./types.ts";

/**
 * The options of the runtime.
 */
export interface AgentCommunicationRuntimeOptions {
	/** The store of the jobs. */
	store: JobStore;
	/** The clock. */
	now?: () => number;
	/** The adapters of the workers. */
	adapters?: Partial<Record<ConsultTarget, ConsultAdapter>>;
	/** How many workers may run at the same time. */
	maxConcurrent?: number;
	/** How many workers of one target may run at the same time. */
	maxPerTarget?: number;
	/** How long a consultation may take. */
	defaultTimeoutMs?: number;
	/** The longest consultation the harness allows. */
	maxTimeoutMs?: number;
	/** How long a tool call waits for the answer. */
	defaultWaitMs?: number;
	/** The log of the runtime. */
	log?: (message: string) => void;
	/** The ids of the jobs, for the tests. */
	ids?: () => string;
	/**
	 * The environment of the workers.
	 *
	 * The environment is filtered before the worker sees it. The default
	 * is the environment of the process.
	 */
	env?: Record<string, string | undefined>;
	/**
	 * Where the copies of the workspace live.
	 *
	 * The worker of a consult works in a copy of the workspace, so it
	 * cannot change the workspace of the user. The copy is thrown away
	 * when the job ends.
	 */
	stagingRoot?: string;
	/**
	 * How long a stopped worker may take to go.
	 *
	 * A worker that ignores the signal is killed after this time. The
	 * slot of the job stays taken until the worker is really gone.
	 */
	killGraceMs?: number;
	/**
	 * The stage of a workspace.
	 *
	 * The default stages the workspace. A caller that does not want a
	 * copy (a test of the runner itself) may say so.
	 */
	stage?: (root: string, jobId: string) => StagedWorkspace;
	/**
	 * Called when a job starts.
	 *
	 * The owner of the job shows it: the row of the status names the
	 * worker that is running.
	 */
	onJobStart?: (job: ConsultJobEvent) => void;
	/**
	 * Called when a job is over.
	 *
	 * The owner of the job removes its row: a row that outlives its job
	 * is a lie about the session.
	 */
	onJobEnd?: (job: ConsultJobEvent) => void;
}

/**
 * What the owner of a job is told.
 */
export interface ConsultJobEvent {
	/** The id of the job. */
	jobId: string;
	/** The worker that was asked. */
	target: ConsultTarget;
	/** The state of the job. */
	status: ConsultStatus;
	/** The session that asked. */
	sessionId: string;
}

/**
 * A request to the runtime.
 */
export interface ConsultInput {
	/** The worker that is asked. */
	target: string;
	/** The question. */
	prompt: string;
	/** The canonical absolute path of the workspace of the worker. */
	workspace: string;
	/** How long the worker may take. */
	timeoutMs?: number;
	/** Who asks. */
	sender: ConsultSender;
	/**
	 * The hop of the request.
	 *
	 * The hop counts the consultations of a consultation. It is one at the
	 * top, and a worker that may consult again would make it two.
	 */
	hop?: number;
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
 * A job that is running right now.
 */
interface RunningJob {
	/** The state of the job. */
	record: JobRecord;
	/** The promise of the result. */
	done: Promise<ConsultResult>;
	/** The stop of the worker. */
	abort: AbortController;
	/**
	 * The copy of the workspace of a running job.
	 *
	 * The copy is found while the job runs: a caller that waits for a
	 * job that does not answer has to be able to take the copy away,
	 * because the copy of the workspace of the user may not stay in the
	 * temporary directory of the machine.
	 */
	stagedPath?: string;
}

/**
 * The longest consultation the harness allows.
 *
 * Ten minutes is long enough for a hard question and short enough that a
 * worker cannot hold a session for ever.
 */
export const DEFAULT_MAX_TIMEOUT_MS = 600_000;

/**
 * The default time of a consultation.
 */
export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * How many workers may run at the same time.
 */
export const DEFAULT_MAX_CONCURRENT = 2;

/**
 * How many workers of one target may run at the same time.
 */
export const DEFAULT_MAX_PER_TARGET = 1;

/**
 * The hop limit of the consultations.
 */
export const CONSULT_HOP_LIMIT = 1;

/**
 * The runtime of the consultations.
 */
export class AgentCommunicationRuntime {
	private readonly store: JobStore;
	private readonly now: () => number;
	private readonly adapters: Partial<Record<ConsultTarget, ConsultAdapter>>;
	private readonly maxConcurrent: number;
	private readonly maxPerTarget: number;
	private readonly defaultTimeoutMs: number;
	private readonly maxTimeoutMs: number;
	private readonly defaultWaitMs: number;
	private readonly log: (message: string) => void;
	private readonly ids: () => string;
	/** The environment of the workers, before it is filtered. */
	private readonly envSource: Record<string, string | undefined>;
	/** Where the copies of the workspace live. */
	private readonly stagingRoot: string;
	/** How long a stopped worker may take to go. */
	private readonly killGraceMs?: number;
	/** The stage of a workspace. */
	private readonly stage: (root: string, jobId: string) => StagedWorkspace;
	/** The owner of the rows of the jobs. */
	private readonly onJobStart?: (job: ConsultJobEvent) => void;
	private readonly onJobEnd?: (job: ConsultJobEvent) => void;
	/** The jobs that are running right now. */
	private readonly running = new Map<string, RunningJob>();
	/** The environment of the workers, read once. */
	private env?: Record<string, string>;

	constructor(options: AgentCommunicationRuntimeOptions) {
		this.store = options.store;
		this.now = options.now ?? Date.now;
		this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
		this.maxPerTarget = options.maxPerTarget ?? DEFAULT_MAX_PER_TARGET;
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
		this.defaultWaitMs = options.defaultWaitMs ?? this.defaultTimeoutMs;
		this.log = options.log ?? (() => {});
		this.ids = options.ids ?? (() => randomUUID());
		this.envSource = options.env ?? process.env;
		this.stagingRoot =
			options.stagingRoot ?? join(tmpdir(), "pi-agent-consult");
		this.killGraceMs = options.killGraceMs;
		this.stage =
			options.stage ??
			((root: string, jobId: string) =>
				stageWorkspace(root, { stagingRoot: this.stagingRoot, jobId }));
		this.onJobStart = options.onJobStart;
		this.onJobEnd = options.onJobEnd;
		this.adapters = { ...(options.adapters ?? {}) };
	}

	/**
	 * The adapter of a worker.
	 *
	 * The adapter of a worker that is not known is built here: the caller
	 * names the target, and the target decides the binary.
	 */
	private adapterFor(target: ConsultTarget): ConsultAdapter {
		const known = this.adapters[target];
		if (known) return known;
		const base =
			target === "codex"
				? codexAdapter(this.environment())
				: claudeAdapter(this.environment());
		// The binary of the worker is the one of the machine: the path of
		// the override (`CODEX_BIN`, `CLAUDE_BIN`) wins, and the PATH is
		// walked when there is no override.
		const binary = resolveBinary(target, this.envSource);
		const adapter: ConsultAdapter = binary
			? { ...base, binary }
			: base;
		this.adapters[target] = adapter;
		return adapter;
	}

	/**
	 * The arguments of a consultation.
	 *
	 * The strict arguments ask the worker for nothing, and the tools of
	 * the worker need the sandbox of the operating system. A machine that
	 * cannot start that sandbox would make the worker blind, so the
	 * contained arguments are used there and the copy of the workspace is
	 * the boundary. The harness says so in the record of the job.
	 *
	 * The probe of the sandbox runs in the background, so the first
	 * consultation of a machine uses the contained arguments and the next
	 * ones the strict ones.
	 */
	private argvFor(adapter: ConsultAdapter): {
		argv: readonly string[];
		note?: string;
	} {
		if (!adapter.fallbackArgv) return { argv: adapter.argv };
		// The probe measures the machine with the CLI of the vendor, the
		// one the machine itself has. A stand-in of a test is not asked:
		// the question is about the machine, not about a program that
		// pretends to be the worker.
		const vendorBinary = resolveBinary(adapter.target, process.env);
		const sandbox = vendorBinary
			? sandboxAvailable(vendorBinary, process.env)
			: false;
		if (sandbox === true) return { argv: adapter.argv };
		if (sandbox === false) {
			return {
				argv: adapter.fallbackArgv,
				note: "the sandbox of the machine cannot start; the worker ran with the rights of the user, and the copy of the workspace was the boundary",
			};
		}
		return {
			argv: adapter.fallbackArgv,
			note: "the sandbox of the machine was not measured yet; the copy of the workspace was the boundary",
		};
	}

	/**
	 * The environment of the workers.
	 *
	 * The environment is filtered: the worker is the user's own CLI and it
	 * needs its own session, and it does not need the credentials of the
	 * harness.
	 */
	private environment(): Record<string, string> {
		if (!this.env) this.env = filteredEnv(this.envSource);
		return this.env;
	}

	/**
	 * Start a consultation.
	 *
	 * The job is started and the id is returned at once: a long question
	 * does not have to hold the caller, and the answer is waited for with
	 * `wait()`.
	 */
	start(input: ConsultInput): ConsultResult {
		const target = input.target;
		if (!isConsultTarget(target)) {
			return this.refuse(input, "failed", `unknown target "${String(target)}"`);
		}
		const prompt = (input.prompt ?? "").trim();
		if (prompt.length === 0) {
			return this.refuse(input, "failed", "the question is empty");
		}
		const workspace = (input.workspace ?? "").trim();
		if (!workspace.startsWith("/")) {
			return this.refuse(
				input,
				"failed",
				"the workspace must be an absolute path",
			);
		}
		const hop = input.hop ?? 0;
		if (hop >= CONSULT_HOP_LIMIT) {
			return this.refuse(
				input,
				"failed",
				"a worker may not consult another worker",
			);
		}
		// The worker has to be on the machine before a question is asked:
		// a missing binary is a fact of the machine, and it is named
		// before the job exists.
		if (!resolveBinary(target, this.envSource)) {
			return this.refuse(
				input,
				"failed",
				`${target} is not installed: no runnable ${target} binary was found on the PATH, and ${target.toUpperCase()}_BIN does not point at one`,
			);
		}
		const runningOfTarget = [...this.running.values()].filter(
			(job) => job.record.target === target,
		).length;
		if (runningOfTarget >= this.maxPerTarget) {
			return this.refuse(input, "failed", `a ${target} worker is already running`);
		}
		if (this.running.size >= this.maxConcurrent) {
			return this.refuse(input, "failed", "every worker slot is taken");
		}
		const timeoutMs = Math.min(
			Math.max(1, input.timeoutMs ?? this.defaultTimeoutMs),
			this.maxTimeoutMs,
		);
		const jobId = this.ids();
		const correlationId = this.ids();
		const request: ConsultRequest = {
			jobId,
			correlationId,
			target,
			prompt,
			workspace,
			timeoutMs,
			startedAt: this.now(),
			sender: input.sender,
			keepStaging: input.keepStaging,
		};
		const abort = new AbortController();
		const record: JobRecord = {
			jobId,
			correlationId,
			target,
			workspace,
			status: "running",
			startedAt: request.startedAt,
			sender: input.sender,
			timeoutMs,
		};
		const job: RunningJob = {
			record,
			done: Promise.resolve({
				jobId,
				correlationId,
				target,
				workspace,
				status: "running",
				answer: "",
				durationMs: 0,
			}),
			abort,
		};
		this.running.set(jobId, job);
		this.store.write(record);
		this.onJobStart?.({
			jobId,
			target,
			status: "running",
			sessionId: input.sender.sessionId,
		});
		job.done = this.run(request, job);
		return {
			jobId,
			correlationId,
			target,
			workspace,
			status: "running",
			answer: "",
			durationMs: 0,
		};
	}

	/**
	 * Run the worker of a job.
	 */
	private async run(
		request: ConsultRequest,
		job: RunningJob,
	): Promise<ConsultResult> {
		try {
			return await this.runWorker(request, job);
		} catch (error) {
			// The promise of a job never rejects: a job that fails is a
			// job that is over, and the caller reads its state.
			const diagnostic = `the worker failed: ${
				error instanceof Error ? error.message : String(error)
			}`;
			this.store.write({
				jobId: request.jobId,
				correlationId: request.correlationId,
				target: request.target,
				workspace: request.workspace,
				status: "failed",
				diagnostic,
				startedAt: request.startedAt,
				finishedAt: this.now(),
				sender: request.sender,
				timeoutMs: request.timeoutMs,
			});
			this.running.delete(request.jobId);
			this.onJobEnd?.({
				jobId: request.jobId,
				target: request.target,
				status: "failed",
				sessionId: request.sender.sessionId,
			});
			return {
				jobId: request.jobId,
				correlationId: request.correlationId,
				target: request.target,
				workspace: request.workspace,
				status: "failed",
				answer: "",
				diagnostic,
				// The copy of the workspace may still be there: the
				// caller that owns it has to find it.
				stagedPath: job.stagedPath,
				durationMs: 0,
			};
		}
	}

	/**
	 * Run the worker of a job and read its answer.
	 */
	private async runWorker(
		request: ConsultRequest,
		job: RunningJob,
	): Promise<ConsultResult> {
		const adapter = this.adapterFor(request.target);
		// The worker works in a copy of the workspace: the flags of a CLI
		// are the promise of a CLI, and a measured leak showed that the
		// promise does not hold on every machine. The copy is thrown away
		// when the job ends, so a consultation cannot change the workspace
		// of the user.
		const staged = this.stage(request.workspace, request.jobId);
		if (!staged.copied) {
			// The copy of the workspace could not be made. The worker
			// would then work in the workspace of the user, and a worker
			// may not change it. The job is refused instead: a
			// consultation that cannot keep its promise is not run.
			staged.dispose();
			return this.finish(request, {
				jobId: request.jobId,
				correlationId: request.correlationId,
				target: request.target,
				workspace: request.workspace,
				status: "failed",
				answer: "",
				diagnostic:
					"the workspace could not be copied, so the worker was not started",
				durationMs: this.now() - request.startedAt,
				changedFiles: [],
				// The worker never ran: the job was refused.
				refused: true,
			});
		}
		// The copy of a running job is found by the caller that waits for
		// it: the copy has to go when the job ends, whoever ends it.
		job.stagedPath = staged.path;
		// The picture of the workspace is taken before the worker starts:
		// a consultation may look, and it may not change.
		const before = snapshotWorkspace(request.workspace);
		// The picture of the copy is taken as well: the write lane needs to
		// know what the worker wrote into the copy.
		const stagedBefore = snapshotWorkspace(staged.path);
		let run: Awaited<ReturnType<typeof runCli>>;
		let read: ReturnType<ConsultAdapter["read"]>;
		const argv = this.argvFor(adapter);
		try {
			run = await runCli({
				binary: adapter.binary,
				argv: argv.argv,
				cwd: staged.path,
				stdin: staged.mapPrompt(request.prompt),
				timeoutMs: request.timeoutMs,
				signal: job.abort.signal,
				env: adapter.env,
				now: this.now,
				killGraceMs: this.killGraceMs,
			});
			read = adapter.read(run);
		} finally {
			// The write lane needs the copy of the workspace: the worker
			// wrote into it, and the harness applies the named files of it.
			if (!request.keepStaging) staged.dispose();
		}
		const changedFiles = changesSince(request.workspace, before);
		// The changes of the copy are only measured while the copy is
		// there: a consult throws the copy away, and a copy that is gone
		// would report every file of it as removed.
		const stagedChanges = request.keepStaging
			? changesSince(staged.path, stagedBefore)
			: [];
		const changedNote =
			changedFiles.length > 0
				? `the worker changed ${changedFiles.length} file(s) of the workspace: ${changedFiles.slice(0, 5).join(", ")}`
				: undefined;
		const diagnostic = [read.diagnostic, argv.note, changedNote]
			.filter((part): part is string => typeof part === "string" && part.length > 0)
			.join("; ");
		const result: ConsultResult = {
			jobId: request.jobId,
			correlationId: request.correlationId,
			target: request.target,
			workspace: request.workspace,
			status: read.status,
			answer: staged.mapAnswer(read.answer),
			diagnostic,
			exitCode: run.exitCode,
			durationMs: run.durationMs,
			changedFiles,
			stagedPath: request.keepStaging ? staged.path : undefined,
			stagedChanges,
		};
		return this.finish(request, result);
	}

	/**
	 * The end of a job.
	 *
	 * The state that goes to the disk names the job and its answer. The
	 * question of the user is not written: a job that is recovered needs
	 * to know what it is, and the question is the content of the user.
	 */
	private finish(
		request: ConsultRequest,
		result: ConsultResult,
	): ConsultResult {
		this.store.write({
			jobId: request.jobId,
			correlationId: request.correlationId,
			target: request.target,
			workspace: request.workspace,
			status: result.status,
			answer: result.answer,
			diagnostic: result.diagnostic,
			exitCode: result.exitCode,
			refused: result.refused,
			durationMs: result.durationMs,
			changedFiles: result.changedFiles,
			startedAt: request.startedAt,
			finishedAt: this.now(),
			sender: request.sender,
			timeoutMs: request.timeoutMs,
		});
		this.running.delete(request.jobId);
		this.onJobEnd?.({
			jobId: request.jobId,
			target: request.target,
			status: result.status,
			sessionId: request.sender.sessionId,
		});
		this.log(
			`[agent] ${request.target} ${result.status} in ${result.durationMs}ms (${request.jobId})`,
		);
		return result;
	}

	/**
	 * The result of a job.
	 */
	status(jobId: string): ConsultResult | undefined {
		const running = this.running.get(jobId);
		if (running) {
			return {
				jobId: running.record.jobId,
				correlationId: running.record.correlationId,
				target: running.record.target,
				workspace: running.record.workspace,
				status: "running",
				answer: "",
				durationMs: 0,
			};
		}
		const record = this.store.read(jobId);
		if (!record) return undefined;
		return {
			jobId: record.jobId,
			correlationId: record.correlationId,
			target: record.target,
			workspace: record.workspace,
			status: record.status,
			answer: record.answer ?? "",
			diagnostic: record.diagnostic,
			exitCode: record.exitCode,
			refused: record.refused,
			durationMs: record.durationMs ?? 0,
			changedFiles: record.changedFiles,
		};
	}

	/**
	 * Stop a job.
	 *
	 * The job keeps its worker until the worker is gone: the answer of a
	 * stopped worker never arrives.
	 */
	async cancel(jobId: string): Promise<boolean> {
		const job = this.running.get(jobId);
		if (!job) return false;
		job.abort.abort();
		await job.done.catch(() => undefined);
		return true;
	}

	/**
	 * The copy of the workspace of a job that still runs.
	 *
	 * The copy of a job that ended is on its result. A job that is still
	 * running has no result yet, so the path is read here.
	 */
	stagedPath(jobId: string): string | undefined {
		return this.running.get(jobId)?.stagedPath;
	}

	/**
	 * Wait for the answer of a job.
	 *
	 * The wait is bounded: a job that does not answer in time leaves the
	 * caller with the id of the job and the state it is in.
	 */
	async wait(
		jobId: string,
		waitMs?: number,
	): Promise<ConsultResult | undefined> {
		const job = this.running.get(jobId);
		if (!job) return this.status(jobId);
		const bound = waitMs ?? this.defaultWaitMs;
		const timeout = new Promise<undefined>((resolve) => {
			const timer = setTimeout(() => resolve(undefined), bound);
			timer.unref?.();
		});
		const result = await Promise.race([job.done, timeout]).catch(() => undefined);
		return result ?? this.status(jobId);
	}

	/**
	 * Stop every job of the session.
	 *
	 * A session that stops leaves no worker behind: a worker that runs on
	 * answers a question nobody asks any more.
	 */
	async stop(): Promise<void> {
		for (const jobId of [...this.running.keys()]) {
			await this.cancel(jobId);
		}
	}

	/**
	 * A refusal: a job that never ran.
	 */
	private refuse(
		input: ConsultInput,
		status: ConsultStatus,
		diagnostic: string,
	): ConsultResult {
		return {
			jobId: this.ids(),
			correlationId: this.ids(),
			target: isConsultTarget(input.target) ? input.target : "codex",
			workspace: input.workspace ?? "",
			status,
			answer: "",
			diagnostic,
			durationMs: 0,
			// The worker never ran: the caller says so.
			refused: true,
		};
	}
}

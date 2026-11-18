/**
 * The state of the consultations of the session.
 *
 * Every consultation is one job, and the state of a job is durable: the
 * session that asked may be gone when the answer arrives, and the job is
 * still a fact of the machine.
 *
 * The state holds no credential and no prompt. The prompt of the user is
 * not written to disk: a job that is recovered only needs to know what it
 * is, and the answer is the answer of a worker, not a secret.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../../packages/cookie-sanitizer/dist/index.js";
import type {
	ConsultSender,
	ConsultStatus,
	ConsultTarget,
} from "./types.ts";

/**
 * The state of one job.
 */
export interface JobRecord {
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
	/** The answer of the worker, when it answered. */
	answer?: string;
	/** The exit code of the worker, when it ran. */
	exitCode?: number;
	/**
	 * Was the job refused before the worker started?
	 *
	 * A refusal is not a failure of the worker: the worker never ran.
	 */
	refused?: boolean;
	/**
	 * The files of the workspace that the worker changed.
	 *
	 * A consultation may not change the workspace, and the harness watches
	 * the tree itself.
	 */
	changedFiles?: string[];
	/** A short reason, when there is one. */
	diagnostic?: string;
	/** How long the worker took. */
	durationMs?: number;
	/** When the job was created. */
	startedAt: number;
	/** When the job was over. */
	finishedAt?: number;
	/** Who asked. */
	sender: ConsultSender;
	/** How long the job may take. */
	timeoutMs: number;
}

/**
 * How long the state of a job is kept.
 *
 * The state holds the answer of the worker, and the answer may quote the
 * workspace of the user. A week is long enough for a session to ask for
 * the answer of a job, and short enough that the state does not pile up.
 */
export const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The store of the jobs.
 *
 * Every job is one file, so a job is never half written and a reader never
 * sees a job without its state.
 */
export class JobStore {
	/** The root of the store. */
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	/** The directory of the jobs. */
	private jobsDir(): string {
		return join(this.root, "agent-jobs");
	}

	/**
	 * Write the state of a job.
	 *
	 * The write is atomic: the file is renamed over its target, so a
	 * reader never sees a job in a state that never was.
	 */
	write(record: JobRecord): void {
		const dir = this.jobsDir();
		mkdirSync(dir, { recursive: true });
		atomicWriteFileSync(
			join(dir, `${record.jobId}.json`),
			JSON.stringify(record, null, 2),
		);
		// The state of a job is not kept for ever: the answer of the
		// worker may quote the workspace of the user.
		this.expire();
	}

	/**
	 * The states that are too old go.
	 *
	 * A state that is older than the retention is of no use to a session
	 * and is not kept. The age of a state is the time of its file: a
	 * state that was written a week ago is a week old.
	 */
	expire(now: number = Date.now()): number {
		const dir = this.jobsDir();
		if (!existsSync(dir)) return 0;
		let expired = 0;
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			const path = join(dir, name);
			try {
				if (now - statSync(path).mtimeMs <= JOB_RETENTION_MS) continue;
				rmSync(path, { force: true });
				expired++;
			} catch {
				// A state that cannot be read or removed stays: it harms
				// nobody.
			}
		}
		return expired;
	}

	/**
	 * The state of a job.
	 */
	read(jobId: string): JobRecord | undefined {
		const path = join(this.jobsDir(), `${jobId}.json`);
		if (!existsSync(path)) return undefined;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as JobRecord;
			if (!parsed || typeof parsed.jobId !== "string") return undefined;
			return parsed;
		} catch {
			return undefined;
		}
	}

	/**
	 * The states of every job of the store.
	 */
	list(): JobRecord[] {
		const dir = this.jobsDir();
		if (!existsSync(dir)) return [];
		const found: JobRecord[] = [];
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			const record = this.read(name.slice(0, -".json".length));
			if (record) found.push(record);
		}
		return found.sort((a, b) => b.startedAt - a.startedAt);
	}

	/**
	 * End a job: its state is over, and the file goes.
	 *
	 * The state of a job that is over is the answer of the worker, and the
	 * answer is what the session needs. A job that is over and asked for
	 * again says so: it is not run twice.
	 */
	remove(jobId: string): void {
		try {
			rmSync(join(this.jobsDir(), `${jobId}.json`), { force: true });
		} catch {
			// A job that cannot be removed stays: it is a fact of the
			// machine, and a leftover file harms nobody.
		}
	}
}

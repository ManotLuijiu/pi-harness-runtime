/**
 * The runner of a worker process.
 *
 * The harness starts a worker - Codex or Claude Code - and asks it a
 * question. The runner knows nothing about the worker: it starts a
 * process, feeds it the prompt on stdin, collects what it wrote and stops
 * it when the time is up.
 *
 * The rules of the runner are the rules of every process the harness
 * starts:
 *
 * - No shell. The binary and its arguments are passed as they are, so a
 *   prompt is never a command and a workspace is never a shell string.
 * - The prompt goes to stdin. It is not visible in the process list.
 * - The output is bounded. A worker that writes forever does not fill the
 *   memory of the machine.
 * - The environment is filtered. The worker is the user's own CLI and
 *   needs its own session; it does not need the credentials of the
 *   harness.
 * - A stopped worker is really stopped. The runner waits for the process
 *   to be gone before it reports the job as over, so a job is never
 *   reassigned while the old worker is still running.
 */

import { spawn } from "node:child_process";

/**
 * The options of one run.
 */
export interface CliRunOptions {
	/** The binary of the worker. */
	binary: string;
	/** The arguments of the worker. */
	argv: readonly string[];
	/** The working directory of the worker. */
	cwd: string;
	/** What the worker reads on stdin. */
	stdin?: string;
	/** How long the worker may take. */
	timeoutMs: number;
	/** Stops the worker when it is set. */
	signal?: AbortSignal;
	/** How much output is kept. */
	maxOutputBytes?: number;
	/** The environment of the worker. */
	env?: Record<string, string | undefined>;
	/** The clock, for the tests. */
	now?: () => number;
	/** How long the worker may take to stop after a signal. */
	killGraceMs?: number;
}

/**
 * What one run did.
 */
export interface CliRunResult {
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
 * The default bound of the output.
 *
 * The answer of a worker is a piece of text, not a file. A megabyte is far
 * more than any answer needs, and it is far less than the memory of a
 * session.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

/**
 * How long a worker may take to stop after a signal.
 *
 * The worker gets a moment to end on its own. After that it is stopped
 * for good, so a job is never handed to a second worker while the first
 * one is still alive.
 */
export const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * The environment a worker may see.
 *
 * The list is an allowlist: the worker inherits the session it belongs to
 * (its home, its path, its own vendor variables) and nothing else. The
 * credentials of the harness - the webhook token, the keys of the logging
 * - stay in the harness.
 */
const ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"TEMP",
	"TMP",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"TERM",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_RUNTIME_DIR",
	// The session of the vendored CLIs. The worker is the user's own
	// tool: it uses the sign-in of the user, and the harness never copies
	// an auth file.
	"CODEX_HOME",
	"CLAUDE_CONFIG_DIR",
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_VERTEX",
	"CLAUDE_CODE_USE_FOUNDRY",
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"ANTHROPIC_MODEL",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
];

/**
 * The environment of a worker.
 *
 * Only the allowed names are kept, and a name that is not set stays unset:
 * an empty variable is a lie about the machine.
 */
export function filteredEnv(
	env: Record<string, string | undefined>,
	allowlist: readonly string[] = ENV_ALLOWLIST,
): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const name of allowlist) {
		const value = env[name];
		if (typeof value === "string" && value.length > 0) kept[name] = value;
	}
	return kept;
}

/**
 * Is the worker still alive?
 *
 * `child.killed` says that a signal was sent, not that the worker is
 * gone: a worker that ignores the first signal is still running, and it
 * has to be stopped for good.
 */
function isAlive(child: {
	exitCode: number | null;
	signalCode?: string | null;
}): boolean {
	return child.exitCode === null && !child.signalCode;
}

/**
 * Keep the head of a stream, and say that it was cut.
 */
class BoundedBuffer {
	private readonly chunks: Buffer[] = [];
	private size = 0;
	private cut = false;
	private readonly limit: number;

	// The field is declared and assigned by hand: a parameter property is
	// TypeScript that node cannot strip, and the suite runs under node too.
	constructor(limit: number) {
		this.limit = limit;
	}

	/** Add a piece of the output. */
	push(chunk: Buffer): void {
		if (this.size >= this.limit) {
			this.cut = true;
			return;
		}
		const room = this.limit - this.size;
		if (chunk.length > room) {
			this.chunks.push(chunk.subarray(0, room));
			this.size = this.limit;
			this.cut = true;
			return;
		}
		this.chunks.push(chunk);
		this.size += chunk.length;
	}

	/** The output that was kept. */
	text(): string {
		return Buffer.concat(this.chunks).toString("utf8");
	}

	/** Was the output cut off? */
	get truncated(): boolean {
		return this.cut;
	}
}

/**
 * Start a worker and collect what it says.
 *
 * The promise settles when the worker is gone: a worker that is stopped is
 * waited for, so the caller may hand the job to somebody else knowing that
 * the old worker cannot answer any more.
 */
export async function runCli(options: CliRunOptions): Promise<CliRunResult> {
	const now = options.now ?? Date.now;
	const started = now();
	const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	const grace = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	const stdout = new BoundedBuffer(maxOutput);
	const stderr = new BoundedBuffer(maxOutput);

	const finish = (
		exitCode?: number,
		signal?: string,
		extra: Partial<CliRunResult> = {},
	): CliRunResult => ({
		stdout: stdout.text(),
		stderr: stderr.text(),
		exitCode,
		signal,
		timedOut: false,
		cancelled: false,
		truncated: stdout.truncated || stderr.truncated,
		durationMs: Math.max(0, now() - started),
		...extra,
	});

	return new Promise<CliRunResult>((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(options.binary, [...options.argv], {
				cwd: options.cwd,
				env: options.env ?? filteredEnv(process.env),
				stdio: ["pipe", "pipe", "pipe"],
				shell: false,
			});
		} catch (error) {
			resolve(
				finish(undefined, undefined, {
					spawnError: error instanceof Error ? error.message : String(error),
				}),
			);
			return;
		}

		let timedOut = false;
		let cancelled = false;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;

		const stop = () => {
			if (!isAlive(child)) return;
			child.kill("SIGTERM");
			// The worker gets a moment to end on its own. After that it is
			// stopped for good: the job may only be given to a second
			// worker when the first one is really gone.
			killTimer = setTimeout(() => {
				if (isAlive(child)) {
					child.kill("SIGKILL");
				}
			}, grace);
			killTimer.unref?.();
		};

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			stop();
		}, options.timeoutMs);
		timeoutTimer.unref?.();

		const onAbort = () => {
			cancelled = true;
			stop();
		};
		if (options.signal) {
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}

		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

		// The prompt goes to stdin and the stream ends: the worker reads
		// its question and works.
		if (options.stdin !== undefined) {
			child.stdin?.on("error", () => {
				// A worker that closed its stdin cannot read the prompt.
				// The exit code of the worker says what went wrong.
			});
			child.stdin?.end(options.stdin);
		} else {
			child.stdin?.end();
		}

		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			if (killTimer) clearTimeout(killTimer);
			// The listener of the abort goes with the run: a signal that
			// is used again must not keep a reference to a dead run.
			options.signal?.removeEventListener("abort", onAbort);
			resolve(finish(undefined, undefined, { spawnError: error.message }));
		});

		child.on("close", (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			if (killTimer) clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve(
				finish(
					code === null ? undefined : code,
					signal ?? undefined,
					{ timedOut, cancelled },
				),
			);
		});
	});
}

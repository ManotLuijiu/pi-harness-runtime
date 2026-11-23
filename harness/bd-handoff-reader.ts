/**
 * The reader of the bd handoffs.
 *
 * A handoff is a durable note that another agent left in the issue
 * tracker: "here is a finding, here is a checkpoint, here is work I could
 * not finish". The harness reads those notes so it can pick them up when
 * the session is idle.
 *
 * The rules of this reader are the rules of every read of an external
 * program:
 *
 * - No shell. The binary and its arguments are passed as they are.
 * - The store is named. `bd where --json` says which store the command
 *   resolved to, and a store that is not the store of this workspace is a
 *   failure, not a queue of somebody else's work.
 * - The read is bounded. The command may take its time and it may write
 *   a lot; both are bounded.
 * - A failure is a failure. A read that failed is never an empty list:
 *   "unavailable" and "there is nothing" are different facts, and only
 *   one of them lets the harness say that the work is done.
 * - The shape of the data is kept. The metadata and the description of an
 *   issue carry the handoff, so a reader that drops them drops the
 *   handoff.
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * How long a read of bd may take.
 *
 * The reader runs in the background of a session: a read that hangs must
 * not hold the session, and a read that hangs says nothing about the
 * queue.
 */
export const DEFAULT_BD_TIMEOUT_MS = 15_000;

/**
 * How much output of bd is kept.
 *
 * The list of a large store is large. The bound is generous enough for a
 * store of thousands of issues and small enough to keep the memory of a
 * session calm. Output beyond the bound is reported as a cut read, never
 * as a short list.
 */
export const DEFAULT_BD_MAX_OUTPUT_BYTES = 8_000_000;

/**
 * The statuses that are work.
 *
 * A closed issue is not work, and an issue that is not in one of these
 * states is not work either.
 */
export const BD_OPEN_STATUSES = ["open", "in_progress", "blocked", "deferred"] as const;

/**
 * The name of the metadata key that carries a handoff.
 */
export const BD_HANDOFF_METADATA_KEY = "agentHandoff";

/**
 * The version of the protocol this reader understands.
 */
export const BD_HANDOFF_PROTOCOL_VERSION = 1;

/**
 * Why a read failed.
 *
 * The kinds are kept apart: a missing program, a wrong store, a broken
 * answer and an unsupported option need different repairs, and a harness
 * that folds them together reports "no handoffs" for a machine that
 * cannot even run bd.
 */
export type BdReadFailureKind =
	| "cli-missing"
	| "workspace-mismatch"
	| "read-failed"
	| "timeout"
	| "truncated"
	| "malformed-json"
	| "unsupported";

/**
 * A read that failed.
 */
export interface BdReadFailure {
	/** Why the read failed. */
	kind: BdReadFailureKind;
	/** A short reason, for the log and for the status row. */
	message: string;
	/** The command that failed, without any argument of the user. */
	command?: string;
}

/**
 * The result of a read.
 *
 * A failure carries no value: the reader never answers an empty list for
 * a read that did not happen.
 */
export type BdReadResult<T> =
	| {
			ok: true;
			value: T;
			/** What the reader noticed while reading. */
			warnings: string[];
	  }
	| { ok: false; failure: BdReadFailure };

/**
 * One issue of the store, in the shape the CLI gave it.
 */
export interface BdIssue {
	/** The id of the issue. */
	id: string;
	/** The title of the issue. */
	title: string;
	/** The description of the issue, when it has one. */
	description?: string;
	/** The status of the issue. */
	status: string;
	/** The priority of the issue. */
	priority?: number;
	/** The kind of the issue. */
	issueType?: string;
	/** The owner of the issue. */
	owner?: string;
	/** The labels of the issue. */
	labels?: string[];
	/** When the issue was created. */
	createdAt?: string;
	/** When the issue was changed. */
	updatedAt?: string;
	/** The metadata of the issue, as it was given. */
	metadata?: Record<string, unknown>;
}

/**
 * The handoff a producer left in an issue.
 */
export interface BdHandoffEnvelope {
	/** The version of the protocol. */
	version: number;
	/** The stable id of the handoff. */
	handoffId: string;
	/** The id that ties the reply to the request. */
	correlationId?: string;
	/** The kind of the handoff. */
	kind?: string;
	/** The agent that wrote it. */
	producer?: string;
	/** The agent that is addressed. */
	recipient?: string;
	/** The workspace the handoff belongs to. */
	workspaceId?: string;
	/** The request the handoff belongs to. */
	requestId?: string;
	/**
	 * The revision of the handoff.
	 *
	 * A producer raises it when the content of the handoff changes, so
	 * the reader can tell a new handoff from the same one again.
	 */
	revision: number;
	/** What should happen. */
	action?: string;
	/** What the handoff says. */
	summary?: string;
	/** Where the evidence is. */
	evidenceRefs?: string[];
	/** What has to be true when the work is done. */
	acceptance?: string[];
	/** The live job of the handoff, when there is one. */
	liveJobId?: string | null;
	/** How the handoff is delivered. */
	deliveryHint?: string;
}

/**
 * An issue that carries a handoff.
 */
export interface BdHandoffIssue {
	/** The issue itself. */
	issue: BdIssue;
	/** The handoff it carries. */
	envelope: BdHandoffEnvelope;
}

/**
 * The identity of the store that was resolved.
 */
export interface BdStoreIdentity {
	/** The directory of the store. */
	path: string;
	/** The database of the store. */
	databasePath: string;
	/** The prefix of the ids of the store. */
	prefix: string;
	/** The version of the schema of the store. */
	schemaVersion?: number;
}

/**
 * What one run of bd did.
 */
export interface BdExecResult {
	/** What bd wrote to stdout. */
	stdout: string;
	/** What bd wrote to stderr. */
	stderr: string;
	/** The exit code of bd, when it ran. */
	exitCode?: number;
	/** Did bd run out of time? */
	timedOut: boolean;
	/** Did bd even start? */
	spawnError?: string;
	/** Was the output cut off? */
	truncated: boolean;
}

/**
 * The way the reader runs bd.
 *
 * The reader takes the runner from the outside, so a test can read a
 * store that does not exist without a program on the machine.
 */
export type BdCommandRunner = (
	binary: string,
	args: readonly string[],
	options: {
		cwd: string;
		timeoutMs: number;
		maxOutputBytes: number;
		env: Record<string, string>;
	},
) => Promise<BdExecResult>;

/**
 * The options of the reader.
 */
export interface BdHandoffReaderOptions {
	/** The workspace the store belongs to. */
	workspace: string;
	/** The binary of bd. */
	binary?: string;
	/** The timeout of one read. */
	timeoutMs?: number;
	/** The bound of the output of one read. */
	maxOutputBytes?: number;
	/** The way bd is run. */
	run?: BdCommandRunner;
	/** The environment of bd. */
	env?: Record<string, string | undefined>;
}

/**
 * The environment a read of bd may see.
 *
 * The list is an allowlist: bd needs its path and its home to find its
 * own configuration, and it needs nothing of the harness.
 */
const BD_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"TMPDIR",
	"TEMP",
	"TMP",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_RUNTIME_DIR",
	"BEADS_DIR",
];

/**
 * The environment of a read.
 */
function bdEnv(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const name of BD_ENV_ALLOWLIST) {
		const value = env[name];
		if (typeof value === "string" && value.length > 0) kept[name] = value;
	}
	return kept;
}

/**
 * The default runner: bd is started without a shell.
 *
 * The arguments are passed as they are, so a title of an issue can never
 * become a command.
 */
export const defaultBdRunner: BdCommandRunner = async (binary, args, options) => {
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	let stdoutBytes = 0;
	let stderrBytes = 0;
	let truncated = false;
	let timedOut = false;
	let settled = false;

	return new Promise<BdExecResult>((resolvePromise) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(binary, [...args], {
				cwd: options.cwd,
				env: options.env,
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
			});
		} catch (error) {
			resolvePromise({
				stdout: "",
				stderr: "",
				timedOut: false,
				truncated: false,
				spawnError: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		const finish = (exitCode?: number, spawnError?: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolvePromise({
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				exitCode,
				timedOut,
				truncated,
				spawnError,
			});
		};

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => {
				if (settled) return;
				child.kill("SIGKILL");
				// The promise is settled here: a child that keeps the
				// pipe of the output open (a grandchild that inherited
				// it) would keep the read pending for ever otherwise.
				finish(undefined);
			}, 2_000).unref?.();
		}, options.timeoutMs);
		timer.unref?.();

		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdoutBytes >= options.maxOutputBytes) {
				truncated = true;
				return;
			}
			const room = options.maxOutputBytes - stdoutBytes;
			if (chunk.length > room) {
				stdout.push(chunk.subarray(0, room));
				stdoutBytes = options.maxOutputBytes;
				truncated = true;
				return;
			}
			stdout.push(chunk);
			stdoutBytes += chunk.length;
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderrBytes >= options.maxOutputBytes) {
				truncated = true;
				return;
			}
			const room = options.maxOutputBytes - stderrBytes;
			if (chunk.length > room) {
				stderr.push(chunk.subarray(0, room));
				stderrBytes = options.maxOutputBytes;
				truncated = true;
				return;
			}
			stderr.push(chunk);
			stderrBytes += chunk.length;
		});

		child.on("error", (error) => finish(undefined, error.message));
		child.on("close", (code) => finish(code === null ? undefined : code));
	});
};

/**
 * The store of a workspace.
 *
 * The store of a workspace is the `.beads` directory of the workspace or
 * of the repository that holds it. A workspace that is a subdirectory of
 * a repository belongs to the store of that repository.
 */
export function expectedStorePath(workspace: string): string {
	let dir = resolve(workspace);
	for (;;) {
		const candidate = join(dir, ".beads");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return join(resolve(workspace), ".beads");
		dir = parent;
	}
}

/**
 * The same path, as the machine names it.
 *
 * Two paths that name the same directory are the same store, even when
 * one of them is a symlink or has a trailing separator.
 */
function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/**
 * A short reason of a run of bd.
 */
function reasonOf(result: BdExecResult): string {
	const text = `${result.stderr}\n${result.stdout}`.trim();
	if (text.length === 0) return "bd said nothing";
	const line = text.split("\n").find((entry) => entry.trim().length > 0);
	return (line ?? text).slice(0, 300);
}

/**
 * Is this JSON an array of issues?
 */
function isIssueArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

/**
 * The reader of the handoffs of a store.
 */
export class BdHandoffReader {
	private readonly options: BdHandoffReaderOptions;
	private readonly run: BdCommandRunner;

	constructor(options: BdHandoffReaderOptions) {
		this.options = options;
		this.run = options.run ?? defaultBdRunner;
	}

	/** The workspace of the reader. */
	get workspace(): string {
		return this.options.workspace;
	}

	/** The binary of the reader. */
	get binary(): string {
		return this.options.binary ?? "bd";
	}

	/**
	 * Run bd and read its answer.
	 *
	 * The answer of a program is not a fact until it was parsed, so this
	 * method only reports what happened to the process.
	 */
	private async exec(
		args: readonly string[],
	): Promise<BdReadResult<BdExecResult>> {
		const command = `bd ${args.join(" ")}`;
		const result = await this.run(this.binary, args, {
			cwd: this.options.workspace,
			timeoutMs: this.options.timeoutMs ?? DEFAULT_BD_TIMEOUT_MS,
			maxOutputBytes: this.options.maxOutputBytes ?? DEFAULT_BD_MAX_OUTPUT_BYTES,
			env: bdEnv(this.options.env ?? process.env),
		});
		if (result.spawnError) {
			const missing = /ENOENT|not found/i.test(result.spawnError);
			return {
				ok: false,
				failure: {
					kind: missing ? "cli-missing" : "read-failed",
					message: missing
						? "bd is not on this machine"
						: `bd could not be started: ${result.spawnError}`,
					command,
				},
			};
		}
		if (result.timedOut) {
			return {
				ok: false,
				failure: {
					kind: "timeout",
					message: "bd did not answer in time",
					command,
				},
			};
		}
		if (result.exitCode !== undefined && result.exitCode !== 0) {
			const reason = reasonOf(result);
			return {
				ok: false,
				failure: {
					kind: /unknown flag|unknown option|flag provided but not defined/i.test(
						reason,
					)
						? "unsupported"
						: "read-failed",
					message: reason,
					command,
				},
			};
		}
		if (result.truncated) {
			return {
				ok: false,
				failure: {
					kind: "truncated",
					message: "the answer of bd was cut off - the read is incomplete",
					command,
				},
			};
		}
		return { ok: true, value: result, warnings: [] };
	}

	/**
	 * Parse the answer of bd as JSON.
	 *
	 * A broken answer is a failure of the read, not an empty answer.
	 */
	private parse<T>(
		text: string,
		command: string,
	): BdReadResult<T> {
		try {
			return { ok: true, value: JSON.parse(text) as T, warnings: [] };
		} catch (error) {
			return {
				ok: false,
				failure: {
					kind: "malformed-json",
					message: `bd did not answer with JSON: ${
						error instanceof Error ? error.message : String(error)
					}`,
					command,
				},
			};
		}
	}

	/**
	 * The store that bd resolves to, when it is the store of this
	 * workspace.
	 *
	 * The identity of the store is asked first: a reader that reads
	 * somebody else's store delivers somebody else's work.
	 */
	async store(): Promise<BdReadResult<BdStoreIdentity>> {
		const run = await this.exec(["where", "--json"]);
		// The comparison is explicit: a truthiness check does not tell the
		// type checker which half of the result it is, and the failure of
		// a read carries no value.
		if (run.ok === false) return run;
		const parsed = this.parse<unknown>(run.value.stdout, "bd where --json");
		if (parsed.ok === false) return parsed;
		const raw = parsed.value as Record<string, unknown> | null;
		if (!raw || typeof raw !== "object") {
			return {
				ok: false,
				failure: {
					kind: "malformed-json",
					message: "bd did not name its store",
					command: "bd where --json",
				},
			};
		}
		const path = typeof raw.path === "string" ? raw.path : "";
		const databasePath =
			typeof raw.database_path === "string" ? raw.database_path : "";
		const prefix = typeof raw.prefix === "string" ? raw.prefix : "";
		if (path.length === 0) {
			return {
				ok: false,
				failure: {
					kind: "workspace-mismatch",
					message: "bd did not resolve a store",
					command: "bd where --json",
				},
			};
		}
		const expected = canonical(expectedStorePath(this.options.workspace));
		if (canonical(path) !== expected) {
			return {
				ok: false,
				failure: {
					kind: "workspace-mismatch",
					message: `bd resolved the store of another workspace: ${path}`,
					command: "bd where --json",
				},
			};
		}
		const schemaVersion =
			typeof raw.schema_version === "number" ? raw.schema_version : undefined;
		return {
			ok: true,
			value: { path, databasePath, prefix, schemaVersion },
			warnings: [],
		};
	}

	/**
	 * The issues of the store that carry a handoff.
	 *
	 * The list is unbounded on purpose: the default of the CLI is a page
	 * of fifty, and a page that ends silently is a queue that looks empty.
	 * The output is bounded instead, and a cut answer is a failure.
	 */
	async handoffs(): Promise<
		BdReadResult<{ handoffs: BdHandoffIssue[]; candidates: BdIssue[] }>
	> {
		const store = await this.store();
		if (store.ok === false) return store;

		const args = [
			"--readonly",
			"list",
			"--json",
			"--no-pager",
			"--flat",
			"--limit",
			"0",
			"--status",
			BD_OPEN_STATUSES.join(","),
		];
		// The list is read without the filter of the CLI: the filter
		// narrows the read to the issues that carry the handoff in the
		// metadata, and a producer that keeps the handoff in the
		// description would be lost by it. Every issue of the list is
		// read below, and the handoff is looked for in the metadata and
		// in the description.

		const run = await this.exec(args);
		if (run.ok === false) return run;
		const parsed = this.parse<unknown>(run.value.stdout, "bd list --json");
		if (parsed.ok === false) return parsed;
		if (!isIssueArray(parsed.value)) {
			return {
				ok: false,
				failure: {
					kind: "malformed-json",
					message: "bd did not answer with a list of issues",
					command: "bd list --json",
				},
			};
		}

		const warnings: string[] = [];
		const handoffs: BdHandoffIssue[] = [];
		const candidates: BdIssue[] = [];
		for (const entry of parsed.value) {
			if (!entry || typeof entry !== "object") {
				warnings.push("an entry of the list of bd was not an issue");
				continue;
			}
			const issue = toIssue(entry as Record<string, unknown>);
			if (!issue) {
				warnings.push("an entry of the list of bd had no id");
				continue;
			}
			const envelope = parseHandoffEnvelope(issue);
			if (envelope) handoffs.push({ issue, envelope });
			else candidates.push(issue);
		}

		return { ok: true, value: { handoffs, candidates }, warnings };
	}

	/**
	 * One issue of the store, read again by its id.
	 *
	 * The read of one issue is what a handoff is checked against before
	 * anything is dispatched: a closed issue and a missing issue are
	 * different facts.
	 */
	async issue(id: string): Promise<BdReadResult<BdIssue | null>> {
		const run = await this.exec(["--readonly", "show", id, "--json"]);
		if (run.ok === false) {
			// An issue that is not there is not a broken read: the CLI
			// answers with an error and no issue.
			if (run.failure.kind === "read-failed" && /no issue|not found/i.test(run.failure.message)) {
				return { ok: true, value: null, warnings: [] };
			}
			return run;
		}
		const parsed = this.parse<unknown>(run.value.stdout, `bd show ${id} --json`);
		if (parsed.ok === false) return parsed;
		// The CLI answers with a list: one entry for every issue that was
		// asked for. An answer that is not a list is read as one issue, so
		// a version of the CLI that answers with a single object still
		// works.
		const answer = parsed.value;
		const raw = (Array.isArray(answer) ? answer[0] : answer) as
			| Record<string, unknown>
			| null
			| undefined;
		if (!raw) return { ok: true, value: null, warnings: [] };
		const issue = toIssue(raw);
		if (!issue) {
			return {
				ok: false,
				failure: {
					kind: "malformed-json",
					message: "bd did not answer with an issue",
					command: `bd show ${id} --json`,
				},
			};
		}
		return { ok: true, value: issue, warnings: [] };
	}
}

/**
 * The issue of one entry of the list of bd.
 *
 * The shape of the entry is kept: the metadata and the description carry
 * the handoff, and a reader that drops them drops the handoff.
 */
export function toIssue(raw: Record<string, unknown>): BdIssue | null {
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (id.length === 0) return null;
	const title = typeof raw.title === "string" ? raw.title : "";
	const description =
		typeof raw.description === "string" ? raw.description : undefined;
	const status = typeof raw.status === "string" ? raw.status : "unknown";
	const metadata =
		raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
			? (raw.metadata as Record<string, unknown>)
			: undefined;
	const issue: BdIssue = { id, title, status };
	if (description !== undefined) issue.description = description;
	if (typeof raw.priority === "number") issue.priority = raw.priority;
	if (typeof raw.issue_type === "string") issue.issueType = raw.issue_type;
	if (typeof raw.owner === "string") issue.owner = raw.owner;
	if (Array.isArray(raw.labels)) {
		issue.labels = raw.labels.filter((entry): entry is string => typeof entry === "string");
	}
	if (typeof raw.created_at === "string") issue.createdAt = raw.created_at;
	if (typeof raw.updated_at === "string") issue.updatedAt = raw.updated_at;
	if (metadata) issue.metadata = metadata;
	return issue;
}

/**
 * The handoff an issue carries, when it carries one.
 *
 * A handoff is either in the metadata of the issue or in a block of the
 * description. The metadata is the shape the CLI supports; the block is
 * the fallback for a producer that cannot write metadata.
 */
export function parseHandoffEnvelope(
	issue: BdIssue,
): BdHandoffEnvelope | null {
	const fromMetadata = envelopeFromMetadata(issue.metadata);
	if (fromMetadata) return fromMetadata;
	return envelopeFromDescription(issue.description);
}

/**
 * The handoff in the metadata of an issue.
 */
function envelopeFromMetadata(
	metadata: Record<string, unknown> | undefined,
): BdHandoffEnvelope | null {
	if (!metadata) return null;
	const raw = metadata[BD_HANDOFF_METADATA_KEY];
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	return toEnvelope(raw as Record<string, unknown>);
}

/**
 * The marker of a handoff in a description.
 */
const DESCRIPTION_MARKER = "<!-- agent-handoff";

/**
 * The handoff in the description of an issue.
 */
function envelopeFromDescription(
	description: string | undefined,
): BdHandoffEnvelope | null {
	if (!description) return null;
	const start = description.indexOf(DESCRIPTION_MARKER);
	if (start < 0) return null;
	const open = description.indexOf("{", start);
	if (open < 0) return null;
	// The block ends at the end of the JSON object: the braces are
	// counted, so a description with braces in a string does not end the
	// block early.
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = open; index < description.length; index += 1) {
		const char = description[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				try {
					const raw = JSON.parse(description.slice(open, index + 1)) as unknown;
					if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
					return toEnvelope(raw as Record<string, unknown>);
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

/**
 * The handoff of one record.
 *
 * A record that does not name a handoff and does not name a revision is
 * not a handoff: a producer that writes half a protocol does not get the
 * reader to guess.
 */
export function toEnvelope(raw: Record<string, unknown>): BdHandoffEnvelope | null {
	const version = typeof raw.version === "number" ? raw.version : undefined;
	const handoffId =
		typeof raw.handoffId === "string" ? raw.handoffId.trim() : "";
	const revision = typeof raw.revision === "number" ? raw.revision : undefined;
	if (version === undefined || handoffId.length === 0 || revision === undefined) {
		return null;
	}
	if (version !== BD_HANDOFF_PROTOCOL_VERSION) return null;
	if (!Number.isFinite(revision) || revision < 1) return null;
	const envelope: BdHandoffEnvelope = { version, handoffId, revision };
	const correlationId = typeof raw.correlationId === "string" ? raw.correlationId : undefined;
	if (correlationId) envelope.correlationId = correlationId;
	const kind = typeof raw.kind === "string" ? raw.kind : undefined;
	if (kind) envelope.kind = kind;
	const producer = typeof raw.producer === "string" ? raw.producer : undefined;
	if (producer) envelope.producer = producer;
	const recipient = typeof raw.recipient === "string" ? raw.recipient : undefined;
	if (recipient) envelope.recipient = recipient;
	const workspaceId = typeof raw.workspaceId === "string" ? raw.workspaceId : undefined;
	if (workspaceId) envelope.workspaceId = workspaceId;
	const requestId = typeof raw.requestId === "string" ? raw.requestId : undefined;
	if (requestId) envelope.requestId = requestId;
	const action = typeof raw.action === "string" ? raw.action : undefined;
	if (action) envelope.action = action;
	const summary = typeof raw.summary === "string" ? raw.summary : undefined;
	if (summary) envelope.summary = summary;
	const evidenceRefs = stringList(raw.evidenceRefs);
	if (evidenceRefs) envelope.evidenceRefs = evidenceRefs;
	const acceptance = stringList(raw.acceptance);
	if (acceptance) envelope.acceptance = acceptance;
	if (raw.liveJobId === null) envelope.liveJobId = null;
	else if (typeof raw.liveJobId === "string") envelope.liveJobId = raw.liveJobId;
	const deliveryHint = typeof raw.deliveryHint === "string" ? raw.deliveryHint : undefined;
	if (deliveryHint) envelope.deliveryHint = deliveryHint;
	return envelope;
}

/**
 * A list of strings, when the value is one.
 */
function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const kept = value.filter((entry): entry is string => typeof entry === "string");
	return kept.length > 0 ? kept : undefined;
}

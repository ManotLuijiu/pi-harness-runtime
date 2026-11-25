/**
 * The write lane: a worker writes a plan, the harness applies it.
 *
 * A consult may look and may not change. The write lane is the other way
 * around, and it is narrow on purpose:
 *
 * - The human names the files. The worker may not write anything else.
 * - The worker writes into the copy of the workspace, never into the
 *   workspace itself. The copy is the sandbox that works on every
 *   machine, also where the sandbox of the operating system cannot start.
 * - The harness watches the copy. A file outside the named files is a
 *   refusal: nothing is applied.
 * - The harness applies the files itself, and it writes them atomically.
 *   The worker never touches the workspace of the user.
 *
 * The shape is the shape of the upstream project of Frenemy: it stages the
 * project for the worker of a job, it claims the files of the job, and the
 * driver applies the staged changes under a lock, after it has checked that
 * nothing outside the claimed files was changed. The consult of this
 * repository applies nothing; the write lane applies the named files, and
 * only after the human asked for them by name.
 *
 * The answer of the worker stays data: it never applies anything by
 * itself, and it never approves anything.
 */

import {
	chmodSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ConsultSender, ConsultTarget } from "./types.ts";
import type { AgentCommunicationRuntime } from "./runtime.ts";

/**
 * The request of the write lane.
 */
export interface WriteLaneRequest {
	/** The canonical absolute path of the workspace of the worker. */
	workspace: string;
	/** The worker that is asked. */
	target: ConsultTarget;
	/**
	 * The files the worker may write.
	 *
	 * The paths are relative to the workspace. A path that leaves the
	 * workspace is refused.
	 */
	paths: string[];
	/** The question of the human. */
	prompt: string;
	/** Who asks. */
	sender: ConsultSender;
	/** How long the worker may take. */
	timeoutMs?: number;
}

/**
 * What the write lane did.
 */
export interface WriteLaneOutcome {
	/**
	 * The state of the write.
	 *
	 * - `written`: the named files were applied.
	 * - `nothing`: the worker wrote nothing that the human asked for.
	 * - `refused`: the request or the worker was not allowed to write.
	 * - `failed`: the worker did not answer.
	 */
	status: "written" | "nothing" | "refused" | "failed";
	/** The files that were applied into the workspace. */
	applied: { path: string; bytes: number }[];
	/** The files the worker wrote into the copy. */
	touched: string[];
	/** The answer of the worker. */
	answer?: string;
	/** Why, in one line for the human. */
	diagnostic?: string;
}

/**
 * The content of a file, if it is there.
 */
function readFileOrUndefined(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * The names of the files that the worker may not write.
 *
 * The check of the copy is the real check: the worker may not write
 * anything outside the named files. These names are refused in addition,
 * because a plan belongs in the notes of the project and not in the
 * machinery of it.
 */
const FORBIDDEN = new Set([".git", "node_modules", "package.json", "package-lock.json"]);

/**
 * The real path of a path, as far as it exists.
 *
 * A symlink in the way must not carry the path out of the workspace, so
 * the part of the path that exists is resolved and the rest is appended.
 */
function realPathOf(path: string): string {
	let current = path;
	const rest: string[] = [];
	for (let depth = 0; depth < 64; depth++) {
		try {
			const real = realpathSync(current);
			return rest.length === 0 ? real : join(real, ...rest);
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			rest.unshift(basenameOf(current));
			current = parent;
		}
	}
	return path;
}

/**
 * The name of a path.
 */
function basenameOf(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] ?? path;
}

/**
 * Is the path inside the workspace?
 *
 * The path is relative, it does not climb out of the workspace, and the
 * real path of it stays in the workspace: a symlink may not carry the
 * file out of the workspace of the user.
 */
function isInside(workspace: string, path: string): boolean {
	if (isAbsolute(path)) return false;
	if (path.split(/[\\/]/).includes("..")) return false;
	const resolved = resolve(workspace, path);
	const real = realPathOf(resolved);
	const rel = relative(realPathOf(workspace), real);
	return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Is the path a symlink?
 *
 * A symlinked target is not written: the file behind it may live outside
 * of the workspace, and the guard of the tree cannot see a write through
 * a link.
 */
function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * The question for the worker.
 *
 * The paths of the workspace are the paths of the copy, because the
 * runtime exchanges them.
 */
function writePrompt(request: WriteLaneRequest): string {
	const files = request.paths.map((path) => `- ${path}`).join("\n");
	return [
		"Write the plan into these files of the workspace:",
		files,
		"",
		"Write nothing else. Do not change, create or delete any other file.",
		"Do not run git. Do not install anything.",
		"",
		request.prompt,
		"",
		"Answer with one short line that names the files you wrote.",
	].join("\n");
}

/**
 * A file that the lane is going to write.
 *
 * The lane is a transaction, so everything about a file is known before
 * the first file is touched: the temporary file holds the new content,
 * the original is kept for the rollback, and the mode of the file is
 * remembered.
 */
export interface PreparedFile {
	/** The path of the file, relative to the workspace. */
	path: string;
	/** The content of the worker, as bytes. */
	content: Buffer;
	/** The temporary file next to the destination. */
	temporary: string;
	/** The mode of the destination before the write. */
	mode: number | undefined;
	/** The content of the destination before the write. */
	original: Buffer | undefined;
	/** Did the destination exist before the write? */
	existed: boolean;
}

/**
 * The locks of the applies.
 *
 * Two lanes that write into the same workspace at the same time would
 * read and write the same files. The lock is per workspace, and the
 * applies of one process wait for each other. A second process has its
 * own lock: the check of the conflict of a file is the guard of the
 * tree, and the copy of the workspace is what the worker sees.
 */
const applyLocks = new Map<string, Promise<unknown>>();

/**
 * Do the work with the lock of the workspace.
 */
async function withApplyLock<T>(workspace: string, work: () => T): Promise<T> {
	const key = realPathOf(workspace);
	const previous = applyLocks.get(key) ?? Promise.resolve();
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => gate);
	applyLocks.set(key, tail);
	await previous;
	try {
		return work();
	} finally {
		release();
		if (applyLocks.get(key) === tail) applyLocks.delete(key);
	}
}

/**
 * The result of the check of the destinations.
 */
interface PreflightOutcome {
	ok: boolean;
	prepared?: PreparedFile[];
	diagnostic?: string;
}

/**
 * Check every destination before the first file is touched.
 *
 * A destination that is a link, a directory or something else than a
 * file is refused: the lane is a transaction, and a destination that
 * cannot hold a file is known before anything is written.
 */
export function preflightFiles(
	workspace: string,
	files: { path: string; content: Buffer }[],
): PreflightOutcome {
	const prepared: PreparedFile[] = [];
	for (const file of files) {
		const target = join(workspace, file.path);
		if (isLink(target)) {
			return { ok: false, diagnostic: `"${file.path}" is a link and may not be written` };
		}
		let mode: number | undefined;
		let original: Buffer | undefined;
		let existed = false;
		try {
			const stats = statSync(target);
			if (!stats.isFile()) {
				return {
					ok: false,
					diagnostic: `"${file.path}" is not a file and may not be written`,
				};
			}
			mode = stats.mode & 0o777;
			original = readFileSync(target);
			existed = true;
		} catch {
			// The file is not there: the lane writes a new one.
		}
		prepared.push({
			path: file.path,
			content: file.content,
			temporary: `${target}.pi-write-${process.pid}-${prepared.length}`,
			mode,
			original,
			existed,
		});
	}
	return { ok: true, prepared };
}

/**
 * Write the new content next to every destination.
 *
 * Nothing of the workspace is touched yet: the temporaries hold the new
 * content, and a failure here leaves the workspace as it was.
 */
export function prepareFiles(
	workspace: string,
	prepared: PreparedFile[],
): { ok: boolean; diagnostic?: string } {
	for (const file of prepared) {
		const target = join(workspace, file.path);
		try {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(file.temporary, file.content);
			// The file keeps the mode it had: a file of the user does not
			// become readable by everybody because a worker wrote it.
			if (file.mode !== undefined) chmodSync(file.temporary, file.mode);
		} catch (error) {
			discardTemporaries(prepared);
			return {
				ok: false,
				diagnostic: `"${file.path}" could not be prepared: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	}
	return { ok: true };
}

/**
 * The temporaries of a preparation, away.
 */
function discardTemporaries(prepared: PreparedFile[]): void {
	for (const file of prepared) {
		try {
			rmSync(file.temporary, { force: true });
		} catch {
			// A temporary that stays is a file in the workspace with a name
			// of the harness. The workspace itself is untouched.
		}
	}
}

/**
 * Put the original of a file back.
 *
 * The reason of the failure is returned, so the caller can name the
 * files that could not be restored.
 */
function restoreOriginal(workspace: string, file: PreparedFile): string | undefined {
	const target = join(workspace, file.path);
	try {
		if (!file.existed) {
			rmSync(target, { force: true });
			return undefined;
		}
		const temporary = `${target}.pi-restore-${process.pid}`;
		writeFileSync(temporary, file.original ?? Buffer.alloc(0));
		if (file.mode !== undefined) chmodSync(temporary, file.mode);
		renameSync(temporary, target);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/**
 * Move every prepared file over its destination.
 *
 * The files are moved one after the other, and the original of every one
 * of them is kept. A failure rolls the files that were already moved
 * back, and the reason is named when the rollback fails too.
 */
export function commitFiles(
	workspace: string,
	prepared: PreparedFile[],
	move: (from: string, to: string) => void = renameSync,
): { ok: boolean; bytes?: number[]; diagnostic?: string; rolledBack?: boolean } {
	const moved: PreparedFile[] = [];
	for (const file of prepared) {
		const target = join(workspace, file.path);
		try {
			move(file.temporary, target);
			moved.push(file);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			// The files that were moved are put back: the lane is a
			// transaction, and a half written plan is no plan.
			const failures: string[] = [];
			for (let index = moved.length - 1; index >= 0; index -= 1) {
				const done = moved[index];
				const failure = restoreOriginal(workspace, done);
				if (failure) failures.push(`${done.path} (${failure})`);
			}
			if (failures.length > 0) {
				return {
					ok: false,
					rolledBack: false,
					diagnostic: `"${file.path}" was not written (${reason}); the files that were written before it could not be restored: ${failures.join(", ")}`,
				};
			}
			return {
				ok: false,
				rolledBack: true,
				diagnostic: `"${file.path}" was not written (${reason}); the files that were written before it were put back`,
			};
		}
	}
	return { ok: true, bytes: prepared.map((file) => file.content.byteLength) };
}

/**
 * The files of the copy that the lane is going to write.
 */
interface PendingFiles {
	pending: { path: string; content: string }[];
	/** The reason the write is refused, if it is refused. */
	conflict?: string;
}

/**
 * The files of the copy that the lane is going to write.
 *
 * A file that the worker did not write, or that is the same as the file
 * of the user, is not written. A file that the user edited while the
 * worker ran refuses the whole write: the lane is a transaction.
 */
function collectPending(
	workspace: string,
	staged: string,
	paths: string[],
	before: Map<string, string | undefined>,
): PendingFiles {
	const pending: { path: string; content: string }[] = [];
	for (const path of paths) {
		const content = readFileOrUndefined(join(staged, path));
		if (content === undefined) continue;
		const current = readFileOrUndefined(join(workspace, path));
		if (current === content) continue;
		// The file of the user may not change under the worker: a file
		// that was edited while the worker runs is not overwritten.
		if (current !== before.get(path)) {
			return {
				pending: [],
				conflict: `"${path}" changed in the workspace while the worker was running`,
			};
		}
		pending.push({ path, content });
	}
	return { pending };
}

/**
 * The result of the transaction of the lane.
 */
interface ApplyOutcome {
	ok: boolean;
	applied?: { path: string; bytes: number }[];
	status?: "refused" | "failed";
	diagnostic?: string;
}

/**
 * The transaction of the lane.
 *
 * Every destination is checked, every new content is written next to its
 * destination, and only then the files are moved over the workspace. A
 * failure puts the files that were moved back, and a rollback that
 * fails is reported as a failure of the lane.
 */
async function applyTransaction(
	workspace: string,
	pending: { path: string; content: string }[],
): Promise<ApplyOutcome> {
	const wanted = pending.map((file) => ({
		path: file.path,
		content: Buffer.from(file.content, "utf8"),
	}));
	const preflight = preflightFiles(workspace, wanted);
	const checked = preflight.prepared ?? [];
	if (!preflight.ok) {
		return {
			ok: false,
			status: "refused",
			diagnostic: preflight.diagnostic ?? "the destinations were not checked",
		};
	}
	if (checked.length === 0) {
		// Nothing to write: the worker wrote nothing that was named.
		return { ok: true, applied: [] };
	}
	const committed = await withApplyLock(
		workspace,
		(): {
			ok: boolean;
			bytes?: number[];
			diagnostic?: string;
			rolledBack?: boolean;
		} => {
			const preparation = prepareFiles(workspace, checked);
			if (!preparation.ok) {
				// Nothing was moved over the workspace: it is as it was.
				return { ok: false, rolledBack: true, diagnostic: preparation.diagnostic };
			}
			return commitFiles(workspace, checked);
		},
	);
	if (!committed.ok) {
		return {
			ok: false,
			// A rollback that failed leaves the workspace in a state that
			// nobody asked for: the human has to know that.
			status: committed.rolledBack === false ? "failed" : "refused",
			diagnostic: committed.diagnostic ?? "the files were not written",
		};
	}
	const bytes = committed.bytes ?? [];
	return {
		ok: true,
		applied: checked.map((file, index) => ({
			path: file.path,
			bytes: bytes[index] ?? file.content.byteLength,
		})),
	};
}

/**
 * Run the write lane.
 *
 * The worker writes into the copy of the workspace. The harness looks at
 * the copy, refuses a worker that wrote outside the named files, and
 * applies the named files itself.
 */
export async function writeThroughWorker(
	runtime: AgentCommunicationRuntime,
	request: WriteLaneRequest,
): Promise<WriteLaneOutcome> {
	const workspace = resolve(request.workspace);
	// The names of the files are checked before the worker starts: a
	// request that may not be applied is never given to a worker.
	const paths: string[] = [];
	for (const path of request.paths) {
		const clean = path.trim();
		if (clean.length === 0) continue;
		if (!isInside(workspace, clean)) {
			return {
				status: "refused",
				applied: [],
				touched: [],
				diagnostic: `"${clean}" is not a file of the workspace`,
			};
		}
		if (FORBIDDEN.has(clean.split(/[\\/]/)[0]) || FORBIDDEN.has(clean)) {
			return {
				status: "refused",
				applied: [],
				touched: [],
				diagnostic: `"${clean}" is not a file a worker may write`,
			};
		}
		paths.push(clean.split(sep).join("/"));
	}
	if (paths.length === 0) {
		return {
			status: "refused",
			applied: [],
			touched: [],
			diagnostic: "no file was named",
		};
	}

	// The content of the named files is remembered before the worker
	// starts: a file that the human edits while the worker runs may not
	// be overwritten by the version of the worker.
	const before = new Map<string, string | undefined>();
	for (const path of paths) {
		before.set(path, readFileOrUndefined(join(workspace, path)));
	}
	const started = runtime.start({
		target: request.target,
		prompt: writePrompt(request),
		workspace,
		sender: request.sender,
		keepStaging: true,
		// The worker of the write lane writes into the copy: the human
		// named the files, and the harness applies them.
		mode: "write",
		...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
	});
	if (started.status === "failed" && started.durationMs === 0) {
		// The request was refused before the worker started: the worker is
		// not installed, the question was empty, or the workspace was not
		// the workspace of the worker. Nothing was written, so the lane
		// refuses the request instead of failing.
		return {
			status: "refused",
			applied: [],
			touched: [],
			diagnostic: started.diagnostic ?? "the worker did not start",
		};
	}
	// The path of the copy is read before the wait: the copy is made
	// while the job starts, and a job that ends in the moment the wait
	// expires is no longer in the runtime.
	const stagedPath = runtime.stagedPath(started.jobId);
	const result = (await runtime.wait(started.jobId)) ?? started;
	// The copy of a job that still runs is found through the runtime: the
	// result of a job that did not answer carries no path.
	const staged = result.stagedPath ?? stagedPath ?? runtime.stagedPath(started.jobId);
	// The paths of the copy come with the separator of the platform, the
	// named paths with a slash. The comparison needs one spelling.
	const touched = (result.stagedChanges ?? []).map((path) =>
		path.split(sep).join("/"),
	);
	try {
		if (result.status !== "completed") {
			// The worker did not answer, or it was never started. The copy
			// of the workspace goes away anyway: a failed write does not
			// leave a copy of the project of the user in the temporary
			// directory.
			if (result.refused) {
				// The job was refused before the worker started: a
				// workspace that could not be copied is a refusal of the
				// request, not a failure of the worker.
				return {
					status: "refused",
					applied: [],
					touched,
					answer: result.answer,
					diagnostic:
						result.diagnostic ?? "the worker was not started",
				};
			}
			// The worker may still be stopping: it is stopped here, so
			// that the copy can go.
			await runtime.cancel(started.jobId);
			return {
				status: "failed",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic:
					result.diagnostic ??
					`the worker did not answer (${result.status})`,
			};
		}
		if (!staged) {
			return {
				status: "failed",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic: "the copy of the workspace is gone",
			};
		}
		// The worker may not change the workspace of the user. A file that
		// changed there is named, and the write is refused.
		const changed = result.changedFiles ?? [];
		if (changed.length > 0) {
			return {
				status: "refused",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic: `the worker changed ${changed.length} file(s) of the workspace: ${changed.slice(0, 5).join(", ")}`,
			};
		}
		// The worker may only write the files the human named. A file
		// outside of them is a refusal: nothing is applied.
		const named = new Set(paths);
		const outside = touched.filter((path) => !named.has(path));
		if (outside.length > 0) {
			return {
				status: "refused",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic: `the worker wrote outside the named files: ${outside.slice(0, 5).join(", ")}`,
			};
		}
		// The files are read from the copy, checked, and applied by the
		// harness. The check comes first: the lane is a transaction, so a
		// file that changed in the meantime refuses the whole write and
		// nothing is written.
		const collected = collectPending(workspace, staged, paths, before);
		if (collected.conflict) {
			return {
				status: "refused",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic: collected.conflict,
			};
		}
		const pending = collected.pending;
		// The lane is a transaction: every destination is checked, every
		// new content is written next to its destination, and only then
		// the files are moved over the workspace. A failure puts the
		// files that were moved back.
		const outcome = await applyTransaction(workspace, pending);
		if (!outcome.ok) {
			return {
				status: outcome.status ?? "refused",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic: outcome.diagnostic,
			};
		}
		const applied = outcome.applied ?? [];
		if (applied.length === 0) {
			return {
				status: "nothing",
				applied: [],
				touched,
				answer: result.answer,
				diagnostic: "the worker wrote nothing that was named",
			};
		}
		return {
			status: "written",
			applied,
			touched,
			answer: result.answer,
			diagnostic: `${applied.length} file(s) applied`,
		};
	} finally {
		// The copy is the copy of the workspace: it goes away with the
		// job, also when the job was refused.
		try {
			rmSync(staged as string, { recursive: true, force: true });
		} catch {
			// A copy that cannot be removed is a copy that stays in the
			// temporary directory. The workspace itself is untouched.
		}
	}
}

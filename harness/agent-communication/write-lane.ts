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
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
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
 * Write a file into the workspace, atomically.
 *
 * The content is written next to the file and moved over it, so a reader
 * of the workspace never sees half a file.
 */
function applyFile(workspace: string, path: string, content: string): number {
	const target = join(workspace, path);
	// A symlinked target is not written through.
	if (isLink(target)) {
		throw new Error(`"${path}" is a symlink`);
	}
	mkdirSync(dirname(target), { recursive: true });
	const temporary = `${target}.pi-write-${process.pid}`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, target);
	return Buffer.byteLength(content, "utf8");
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
		const pending: { path: string; content: string }[] = [];
		for (const path of paths) {
			const content = readFileOrUndefined(join(staged, path));
			if (content === undefined) continue;
			const current = readFileOrUndefined(join(workspace, path));
			if (current === content) continue;
			// The file of the user may not change under the worker: a file
			// that was edited while the worker ran is not overwritten.
			if (current !== before.get(path)) {
				return {
					status: "refused",
					applied: [],
					touched,
					answer: result.answer,
					diagnostic: `"${path}" changed in the workspace while the worker was running`,
				};
			}
			pending.push({ path, content });
		}
		// A named path that is a link is refused before the first file is
		// written: the lane is a transaction, and a link is a file the
		// harness may not write through.
		for (const file of pending) {
			if (isLink(join(workspace, file.path))) {
				return {
					status: "refused",
					applied: [],
					touched,
					answer: result.answer,
					diagnostic: `"${file.path}" is a link and may not be written`,
				};
			}
		}
		const applied: { path: string; bytes: number }[] = [];
		for (const file of pending) {
			try {
				applied.push({
					path: file.path,
					bytes: applyFile(workspace, file.path, file.content),
				});
			} catch (error) {
				// The file is a symlink, or it cannot be written. Nothing is
				// applied then: the files that were applied before stay,
				// and the reason is named.
				return {
					status: "refused",
					applied,
					touched,
					answer: result.answer,
					diagnostic: `"${file.path}" was not written: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
		}
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

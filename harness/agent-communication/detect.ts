/**
 * The presence of a worker of another vendor.
 *
 * The harness has to know whether Codex and Claude Code are installed,
 * whether they run and whether they are signed in - before a question is
 * asked, not after it failed.
 *
 * The lookup of the binary follows the upstream wrapper of Frenemy
 * (`tools/platform.mjs`, `resolveBin`): the environment wins with
 * `CODEX_BIN` and `CLAUDE_BIN`, an override that is not runnable switches
 * the worker off, and otherwise the `PATH` of the machine is walked. The
 * upstream code is MIT licensed; this is a thin native adaptation of the
 * reviewed behavior, not a copy.
 *
 * The sign-in is asked of the worker itself, with the command the worker
 * ships: `codex login status` and `claude auth status`. The harness does
 * not read the credentials of the worker, and it never copies them.
 */

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ConsultTarget } from "./types.ts";

const execFileAsync = promisify(execFile);

/**
 * The time a probe may take.
 *
 * The probe asks a version and a sign-in. Neither may hold the session.
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Is this file runnable by the user?
 */
function runnable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * The full path of the command of a worker, when it is there.
 *
 * The environment wins: `CODEX_BIN` and `CLAUDE_BIN` name the binary that
 * is used. An override that is not runnable switches the worker off, so a
 * user can turn a route off without touching the machine.
 */
export function resolveBinary(
	name: string,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const override = env[`${name.toUpperCase()}_BIN`];
	if (override) {
		// The override is resolved: the worker of a consult works in a
		// copy of the workspace, and a relative path would be looked for
		// in the copy.
		return runnable(override) ? resolve(override) : undefined;
	}
	const dirs = String(env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean);
	for (const dir of dirs) {
		const candidate = join(dir, name);
		if (isAbsolute(candidate) && runnable(candidate)) return candidate;
	}
	return undefined;
}

/**
 * What the harness knows about one worker.
 */
export interface WorkerPresence {
	/** The worker. */
	target: ConsultTarget;
	/** Is the worker on the machine? */
	present: boolean;
	/** The binary of the worker, when it is there. */
	path?: string;
	/** The version of the worker, when it answered. */
	version?: string;
	/** Is the worker signed in? `undefined` means "nobody asked it". */
	signedIn?: boolean;
	/** Why the worker is not usable, when it is not. */
	reason?: string;
}

/**
 * Run a probe of the worker and read its output.
 */
async function probe(
	binary: string,
	args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	try {
		const result = await execFileAsync(binary, args, {
			timeout: PROBE_TIMEOUT_MS,
			encoding: "utf8",
			maxBuffer: 256 * 1024,
		});
		return { ok: true, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
	} catch (error) {
		const failed = error as { stdout?: string; stderr?: string };
		return {
			ok: false,
			stdout: failed.stdout ?? "",
			stderr: failed.stderr ?? "",
		};
	}
}

/**
 * The sign-in of Codex.
 *
 * The worker answers the question itself: `codex login status`.
 */
async function codexSignedIn(binary: string): Promise<boolean | undefined> {
	const result = await probe(binary, ["login", "status"]);
	if (!result.ok) return undefined;
	const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
	if (text.includes("logged in")) return true;
	if (text.includes("not logged in") || text.includes("not logged")) return false;
	return undefined;
}

/**
 * The sign-in of Claude Code.
 *
 * The worker answers in JSON: `claude auth status`.
 */
async function claudeSignedIn(binary: string): Promise<boolean | undefined> {
	const result = await probe(binary, ["auth", "status"]);
	const text = `${result.stdout}\n${result.stderr}`;
	if (!result.ok && result.stdout.trim().length === 0) return undefined;
	try {
		const parsed = JSON.parse(result.stdout) as { loggedIn?: unknown };
		if (typeof parsed.loggedIn === "boolean") return parsed.loggedIn;
	} catch {
		// The worker did not answer in JSON. The answer may still name
		// the state in words.
	}
	const lower = text.toLowerCase();
	if (lower.includes("not logged in")) return false;
	if (lower.includes("logged in")) return true;
	return undefined;
}

/**
 * The version of a worker.
 */
async function versionOf(binary: string): Promise<string | undefined> {
	const result = await probe(binary, ["--version"]);
	const text = `${result.stdout}\n${result.stderr}`.trim();
	if (text.length === 0) return undefined;
	return text.split("\n")[0].trim();
}

/**
 * What the harness knows about one worker.
 *
 * The probe asks the worker itself. A worker that is not on the machine
 * is named as such, and a worker that is installed but not signed in is
 * named as that: the two are different problems for the human.
 */
export async function detectWorker(
	target: ConsultTarget,
	env: Record<string, string | undefined> = process.env,
): Promise<WorkerPresence> {
	const binary = resolveBinary(target, env);
	if (!binary) {
		return {
			target,
			present: false,
			reason: `${target} is not installed: it was not found on the PATH and ${target.toUpperCase()}_BIN is not set`,
		};
	}
	const version = await versionOf(binary);
	const signedIn =
		target === "codex" ? await codexSignedIn(binary) : await claudeSignedIn(binary);
	const presence: WorkerPresence = {
		target,
		present: true,
		path: binary,
		version,
		signedIn,
	};
	if (signedIn === false) {
		presence.reason = `${target} is installed but not signed in`;
	}
	return presence;
}

/**
 * What the harness knows about every worker.
 */
export async function detectWorkers(
	env: Record<string, string | undefined> = process.env,
): Promise<WorkerPresence[]> {
	return Promise.all([detectWorker("codex", env), detectWorker("claude", env)]);
}

/**
 * Can the sandbox of the worker start on this machine?
 *
 * The worker of Codex runs its tools inside the sandbox of the operating
 * system, and the sandbox needs rights that a container does not always
 * give. The worker itself answers the question without a model call:
 * `codex sandbox -- /bin/true` runs a command inside the sandbox and
 * fails when the sandbox cannot start.
 *
 * The probe runs in the background and the answer is remembered: a
 * machine does not change its mind about its own sandbox between two
 * consultations. `undefined` means "nobody answered yet".
 */
const sandboxAnswers = new Map<string, boolean>();
const sandboxProbes = new Map<string, Promise<boolean>>();

export function sandboxAvailable(
	binary: string,
	env: Record<string, string | undefined> = process.env,
): boolean | undefined {
	if (sandboxAnswers.has(binary)) return sandboxAnswers.get(binary);
	if (!sandboxProbes.has(binary)) {
		const probe = (async () => {
			try {
				await execFileAsync(binary, ["sandbox", "--", "/bin/true"], {
					timeout: PROBE_TIMEOUT_MS,
					encoding: "utf8",
					env: env as NodeJS.ProcessEnv,
				});
				return true;
			} catch {
				return false;
			}
		})();
		sandboxProbes.set(binary, probe);
		void probe.then((works) => {
			sandboxAnswers.set(binary, works);
		});
	}
	return undefined;
}

/**
 * The row of a worker.
 *
 * The row is plain ASCII and it is short: the state of the machine in one
 * line per worker.
 */
export function presenceLine(presence: WorkerPresence): string {
	if (!presence.present) {
		return `[AGENT] ${presence.target} missing - ${presence.reason ?? "not installed"}`;
	}
	const version = presence.version ?? "unknown version";
	let sign = "sign-in unknown";
	if (presence.signedIn === true) sign = "signed in";
	else if (presence.signedIn === false) sign = "not signed in";
	return `[AGENT] ${presence.target} ${version} - ${sign} (${presence.path})`;
}

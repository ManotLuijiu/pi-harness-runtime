/**
 * The bench of the workspace.
 *
 * The tool of the Frappe lifecycle reads the files of a bench, so it
 * needs to know which bench it is looking at. The bench is found in this
 * order:
 *
 * 1. the environment names it (PI_FRAPPE_BENCH or FRAPPE_BENCH_PATH),
 * 2. the workspace or one of its parents is a bench,
 * 3. a directory named frappe-bench next to the workspace or next to one
 *    of its parents.
 *
 * A directory is a bench when it holds the apps directory and the sites
 * directory: a folder with only one of them is not a bench, and a wrong
 * path would read the wrong files.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The names of the environment that may name a bench. */
const BENCH_ENVIRONMENT = ["PI_FRAPPE_BENCH", "FRAPPE_BENCH_PATH"];

/** The name of the directory that holds a bench in many setups. */
const BENCH_DIRECTORY = "frappe-bench";

/**
 * Is this directory a bench?
 *
 * A bench holds the apps of the sites and the sites themselves. Both
 * directories have to be there.
 */
export function isBench(path: string): boolean {
	try {
		if (!statSync(path).isDirectory()) return false;
		return (
			existsSync(join(path, "apps")) &&
			statSync(join(path, "apps")).isDirectory() &&
			existsSync(join(path, "sites")) &&
			statSync(join(path, "sites")).isDirectory()
		);
	} catch {
		return false;
	}
}

/**
 * The bench of the workspace.
 *
 * The answer is undefined when there is no bench: the caller then does
 * not register a tool that could not read anything.
 *
 * @param start The directory the search starts at (the workspace).
 * @param env The environment of the process.
 */
export function findBench(
	start: string,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	for (const name of BENCH_ENVIRONMENT) {
		const named = env[name];
		if (!named) continue;
		const path = resolve(named);
		if (isBench(path)) return path;
	}
	let current = resolve(start);
	const parents: string[] = [];
	for (let depth = 0; depth < 6; depth += 1) {
		parents.push(current);
		const next = dirname(current);
		if (next === current) break;
		current = next;
	}
	for (const path of parents) {
		if (isBench(path)) return path;
	}
	for (const path of parents) {
		const candidate = join(path, BENCH_DIRECTORY);
		if (isBench(candidate)) return candidate;
	}
	return undefined;
}

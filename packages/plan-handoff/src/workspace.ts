/**
 * The canonical workspace of a process.
 *
 * The routing of a plan handoff starts with the workspace of the sender: the
 * directory the sender actually runs in, not a path copied from an old
 * prompt. Two spellings of the same directory are the same workspace after
 * the canonicalization; two worktrees of one repository are two workspaces,
 * because their paths differ and the rule never collapses them into the
 * repository root.
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * The workspace of a process, canonical and as it was spelled.
 */
export interface CanonicalWorkspace {
	/** The absolute path with every symbolic link resolved. */
	path: string;
	/** The path before the canonicalization, for a diagnostic. */
	raw: string;
}

/**
 * Expand a leading `~` to the home directory.
 *
 * `~` and `~/...` are the home directory; `~user` is not expanded, because
 * the store of the users of a machine is not the business of the router.
 */
export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

/**
 * The canonical form of a path: absolute, with every symbolic link resolved.
 *
 * A path that does not exist cannot be resolved; the absolute form is the
 * answer then. The comparison of two workspaces never fails because of a
 * missing directory.
 */
export function canonicalizePath(path: string): string {
	const expanded = expandHome(path);
	const absolute = resolve(expanded);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

/**
 * The workspace of the current process.
 *
 * The working directory is the source: `process.cwd()` resolves the
 * symbolic links of the current directory already on most systems, and the
 * filesystem is asked for the truth when it can be asked.
 */
export function detectWorkspace(cwd: string = process.cwd()): CanonicalWorkspace {
	return { path: canonicalizePath(cwd), raw: cwd };
}

/**
 * Whether two paths name the same workspace.
 *
 * The comparison is on the canonical form, so a symlink and its target are
 * the same workspace. Two worktrees of one repository have different
 * canonical paths and are therefore different workspaces.
 */
export function sameWorkspace(left: string, right: string): boolean {
	return canonicalizePath(left) === canonicalizePath(right);
}

/**
 * Whether a path lies inside a workspace.
 *
 * The comparison is on the canonical form. A path that does not exist yet
 * is compared in its absolute form, so a reference to a file that is about
 * to be created still counts as inside.
 */
export function isInsideWorkspace(path: string, workspace: string): boolean {
	const target = canonicalizePath(path);
	const root = canonicalizePath(workspace);
	if (target === root) return true;
	return target.startsWith(`${root}/`);
}

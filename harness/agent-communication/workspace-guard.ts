/**
 * The workspace of a consultation is watched, not trusted.
 *
 * The promise of a consultation is that the worker may look and may not
 * change. The flags of a CLI are a promise of the CLI, and a measured
 * leak showed that the promise of Codex does not hold in every project:
 * with the configuration of the user a trusted project let the worker
 * write, whatever the sandbox said.
 *
 * So the harness watches the workspace itself. It takes a picture of the
 * tree before the worker starts and compares it with the tree afterwards,
 * and it names every file that the worker added, changed or removed. The
 * answer of the worker stays data, and a change of the workspace is a
 * fact that is reported, not a change that is hidden.
 *
 * The walk is bounded: `.git` and `node_modules` are left out at any
 * depth, like the staged copy of the upstream project of Frenemy does.
 */

import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The directories that are not part of the picture.
 */
const IGNORED_DIRS = new Set([".git", "node_modules"]);

/**
 * A picture of the tree.
 *
 * The value of a path is the state of the entry: its size and the time it
 * was changed. A file that was written with the same size is a change as
 * long as the filesystem records the time of the write - ext4 does, and a
 * filesystem with a coarse clock can hide a write inside the same tick.
 */
export type WorkspaceSnapshot = Map<string, string>;

/**
 * The state of one entry.
 */
function stateOf(path: string): string | undefined {
	try {
		const stats = lstatSync(path);
		if (stats.isSymbolicLink()) return `link:${stats.size}`;
		if (stats.isDirectory()) return "dir";
		return `${stats.size}:${stats.mtimeMs}`;
	} catch {
		return undefined;
	}
}

/**
 * The picture of the tree.
 */
export function snapshotWorkspace(root: string): WorkspaceSnapshot {
	const snapshot: WorkspaceSnapshot = new Map();
	const walk = (directory: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(directory);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (IGNORED_DIRS.has(entry)) continue;
			const path = join(directory, entry);
			const state = stateOf(path);
			if (state === undefined) continue;
			snapshot.set(relative(root, path), state);
			if (state === "dir") walk(path);
		}
	};
	walk(root);
	return snapshot;
}

/**
 * What changed since a picture was taken.
 *
 * The list holds the paths that were added, changed or removed. It is
 * sorted, so two runs of the same change name the same files.
 */
export function changesSince(
	root: string,
	before: WorkspaceSnapshot,
): string[] {
	const after = snapshotWorkspace(root);
	const changed = new Set<string>();
	for (const [path, state] of after) {
		if (before.get(path) !== state) changed.add(path);
	}
	for (const path of before.keys()) {
		if (!after.has(path)) changed.add(path);
	}
	return [...changed].sort((a, b) => a.localeCompare(b));
}

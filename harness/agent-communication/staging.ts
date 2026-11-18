/**
 * The workspace of a consultation is a copy, not the workspace itself.
 *
 * The flags of a CLI are the promise of a CLI, and a measured leak showed
 * that the promise of Codex does not hold on every machine: the write of
 * the worker was approved by the automatic reviewer of the user, whatever
 * the read-only sandbox said. The sandbox of the operating system cannot
 * help either: on this machine the sandbox of the operating system cannot
 * start at all, so the worker can only work in the mode where it may also
 * write.
 *
 * So the harness gives the worker a copy of the project and keeps the
 * original. The worker reads the copy and writes into the copy; the copy
 * is thrown away when the job ends. A consultation therefore cannot change
 * the workspace of the user, whatever the worker of another vendor does.
 *
 * This is the mechanism of the upstream project of Frenemy: it stages the
 * project for the worker of a job, and the driver applies the staged
 * changes under a lock, after it has checked that nothing outside the
 * claimed files was changed. The consult of this repository never applies
 * anything: the copy is thrown away.
 *
 * The copy leaves `.git` and `node_modules` out, like the upstream copy
 * does. The worker of a consult therefore cannot run git and cannot read
 * the dependencies of the project.
 *
 * The copy has no symlink either. A link that points out of the workspace
 * would let the worker write into the workspace of the user, and a link
 * that points inside it would keep pointing at the workspace when it
 * stands in the copy. The guard of the tree cannot see a write through a
 * link, so the copy does not carry one.
 *
 * A workspace that cannot be copied is a workspace that cannot be staged:
 * the consultation is refused then, because a worker that works in the
 * workspace of the user may change it.
 */

import { cpSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * The directories that are not part of the copy.
 */
const IGNORED = new Set([".git", "node_modules"]);

/**
 * A copy of the workspace that a worker may work in.
 */
export interface StagedWorkspace {
	/** The directory the worker may work in. */
	readonly path: string;
	/** The workspace the copy stands for. */
	readonly root: string;
	/**
	 * Is the worker in a copy?
	 *
	 * A workspace that cannot be copied (a disk that is full, a file that
	 * cannot be read) is a workspace that cannot be staged. The job is
	 * refused then: a worker that works in the workspace of the user may
	 * change it, and a consultation may not change the workspace.
	 */
	readonly copied: boolean;
	/**
	 * The question, with the path of the workspace exchanged.
	 *
	 * The question of the caller names the workspace of the user. The
	 * worker has to see the copy, so the path is exchanged.
	 */
	mapPrompt(prompt: string): string;
	/**
	 * The answer, with the path of the copy exchanged back.
	 *
	 * The answer of the worker names the directory it worked in. The human
	 * has to see the workspace of the user.
	 */
	mapAnswer(answer: string): string;
	/** Throw the copy away. */
	dispose(): void;
}

/**
 * Exchange a path in a text.
 *
 * The real path is the longest prefix that matches, so a path inside the
 * workspace is exchanged as well.
 */
function exchange(text: string, from: string, to: string): string {
	if (text.length === 0) return text;
	return text.split(from).join(to);
}

/**
 * Is the path a symlink?
 */
function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return true;
	}
}

/**
 * The copy of a workspace.
 *
 * The copy is a plain directory outside every repository, so the worker
 * of the vendor finds no project of the user in it and the tools of the
 * worker work as they work in any directory.
 */
export function stageWorkspace(
	root: string,
	options: { stagingRoot: string; jobId: string },
): StagedWorkspace {
	const path = join(options.stagingRoot, options.jobId);
	mkdirSync(path, { recursive: true });
	try {
		// The root itself may be a link: the copy is made of the real
		// path, so the copy holds no link to the workspace of the user.
		const realRoot = realpathSync(root);
		cpSync(realRoot, path, {
			recursive: true,
			dereference: false,
			force: true,
			filter: (source) => {
				const name = basename(source);
				if (IGNORED.has(name) && source !== realRoot) return false;
				// A symlink does not go into the copy. A link that points
				// out of the workspace would let the worker write into the
				// workspace of the user, and the guard of the tree cannot
				// see a write through a link. A link that points inside
				// the workspace would keep pointing at the workspace when
				// it stands in the copy. The copy has no links at all.
				if (source !== realRoot && isLink(source)) return false;
				return true;
			},
		});
	} catch {
		// A workspace that cannot be copied is a workspace that cannot be
		// staged. The job is refused then: the worker may not work in
		// the workspace of the user.
		rmSync(path, { recursive: true, force: true });
		return {
			// The path of the copy, not the workspace of the user: a
			// caller that removes the path may not remove the project of
			// the user.
			path,
			root,
			copied: false,
			mapPrompt: (prompt: string) => prompt,
			mapAnswer: (answer: string) => answer,
			dispose: () => {},
		};
	}
	return {
		path,
		root,
		copied: true,
		mapPrompt: (prompt: string) => exchange(prompt, root, path),
		mapAnswer: (answer: string) => exchange(answer, path, root),
		dispose: () => rmSync(path, { recursive: true, force: true }),
	};
}

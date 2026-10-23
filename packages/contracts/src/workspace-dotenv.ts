/**
 * Reading the dotenv files of a workspace.
 *
 * This module owns the file system part of the environment detection: it
 * finds the ".env" files of a workspace, reads them and skips what must not
 * be read (templates, huge files, unreadable files).
 *
 * It is deliberately free of any other dependency (no node:sqlite) so it
 * can be unit tested everywhere: the detection module itself needs
 * node:sqlite, which not every runtime provides.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

import { orderDotenvFileNames } from "./workspace-env-format.js";

/**
 * The biggest dotenv file that is read. A ".env" file is a few kilobytes;
 * anything bigger is not a configuration file (and reading it on every
 * session start would be a waste).
 */
export const DOTENV_MAX_BYTES = 256 * 1024;

/**
 * True for a template file that only documents the variables
 * (".env.example", ".env.sample", ".env.template", ...).
 *
 * A template is not the configuration of the workspace: it must never
 * decide the mode. The marker is looked for in EVERY segment of the
 * suffix, so ".env.example.local" is a template too.
 */
export function isTemplateDotenvName(name: string): boolean {
	if (name === ".env") return false;
	if (!name.startsWith(".env.")) return false;
	const suffix = name.slice(".env.".length);
	return suffix
		.split(".")
		.some((segment) =>
			/^(examples?|samples?|templates?|tpls?|dists?|defaults?)$/i.test(segment),
		);
}

/**
 * True when the file stays inside the workspace.
 *
 * A symlink may point anywhere: a ".env" that links to /etc/... is not the
 * configuration of the workspace and must not be read.
 */
function isInsideWorkspace(workspacePath: string, filePath: string): boolean {
	try {
		const root = realpathSync(resolve(workspacePath));
		const target = realpathSync(resolve(filePath));
		const rel = relative(root, target);
		if (rel === "") return true;
		return !rel.startsWith("..") && !rel.startsWith(sep);
	} catch {
		// An unreadable path cannot be inside the workspace.
		return false;
	}
}

/**
 * The dotenv files of a workspace as FULL paths, in the order they are read.
 *
 * ".env" comes first, then the well known variants, then every other
 * ".env.*" file. Template files are skipped.
 */
export function listDotenvFiles(workspacePath: string): string[] {
	let entries: string[] = [];
	try {
		entries = readdirSync(workspacePath);
	} catch {
		entries = [];
	}
	const names = entries.filter(
		(name) =>
			(name === ".env" || name.startsWith(".env.")) && !isTemplateDotenvName(name),
	);
	return orderDotenvFileNames(names)
		.filter((name) => {
			try {
				const path = join(workspacePath, name);
				// isFile() is false for a directory named ".env".
				if (!statSync(path).isFile()) return false;
				// A symlink out of the workspace is not a workspace file.
				return isInsideWorkspace(workspacePath, path);
			} catch {
				return false;
			}
		})
		.map((name) => join(workspacePath, name));
}

/**
 * Read the dotenv files of a workspace.
 *
 * The files are read through the full paths of listDotenvFiles, so the
 * workspace - not the current working directory - decides which files are
 * read.
 */
export function readDotenvFiles(workspacePath: string): { name: string; content: string }[] {
	const files: { name: string; content: string }[] = [];
	for (const path of listDotenvFiles(workspacePath)) {
		try {
			const stats = statSync(path);
			if (stats.size > DOTENV_MAX_BYTES) continue;
			files.push({ name: basename(path), content: readFileSync(path, "utf8") });
		} catch {
			// Ignore unreadable files.
		}
	}
	return files;
}

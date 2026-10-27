/**
 * The measured scope of a task.
 *
 * A delegation decision is only worth something when it is based on the
 * work that really has to be done. The numbers of a request are not a
 * measurement: "refactor everything" says nothing about how many files
 * are affected. This module measures the scope in the workspace:
 *
 * - The files of the workspace that the request actually names.
 * - The files the session has already changed.
 * - The groups those files form (one group per package or directory).
 * - The tracked files that reference the measured groups.
 *
 * Every number in the result is a count of something real. When nothing
 * can be measured the result is empty, and the caller has to say so
 * instead of inventing a scope.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** One group of files that can be worked on together. */
export interface ScopeWorkGroup {
	/** The name of the group: the package or the directory of the files. */
	id: string;
	/** The files of the group. */
	files: string[];
}

/** The measured scope of a task. */
export interface ScopeMeasurement {
	/** The files the measurement found. */
	files: string[];
	/** The groups the files form. */
	groups: ScopeWorkGroup[];
	/** The number of tracked files of the workspace. */
	workspaceFiles: number;
	/** The number of tracked files that reference the measured groups. */
	callSites: number;
	/** The histogram of the file extensions. */
	fileTypes: Record<string, number>;
	/** A stable fingerprint of the measurement. */
	fingerprint: string;
	/** The hints of the request that matched a file of the workspace. */
	matchedHints: string[];
	/** How the files were found: the request named them, or the session changed them. */
	source: "request" | "working-tree" | "none";
}

/** The options of {@link measureScope}. */
export interface MeasureScopeOptions {
	/** The root of the workspace. */
	workspacePath: string;
	/** The path fragments of the request, for example a package name. */
	hints?: string[];
	/** The files the session has changed in the workspace. */
	changedFiles?: string[];
	/** The upper bound of the files of one measurement. */
	limit?: number;
}

/** The default upper bound of the files of one measurement. */
const DEFAULT_LIMIT = 400;

/** The maximum number of groups that are searched for references. */
const MAX_REFERENCE_GROUPS = 10;

/**
 * Run a git command in the workspace and return its output.
 *
 * A command that fails is not a measurement: the caller gets an empty
 * result instead of a guess.
 */
function git(workspacePath: string, args: string[]): string {
	try {
		return execFileSync("git", args, {
			cwd: workspacePath,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return "";
	}
}

/**
 * The tracked files of the workspace.
 */
function trackedFiles(workspacePath: string): string[] {
	const out = git(workspacePath, ["ls-files", "-z"]);
	if (!out) return [];
	return out.split("\0").filter(Boolean);
}

/**
 * The files the working tree has changed.
 */
export function changedFiles(workspacePath: string): string[] {
	const out = git(workspacePath, ["status", "--porcelain", "-z"]);
	if (!out) return [];
	const files: string[] = [];
	for (const entry of out.split("\0")) {
		if (!entry) continue;
		// The porcelain format is "XY path"; a rename carries two paths.
		const path = entry.slice(3).trim();
		if (!path) continue;
		if (path.includes(" -> ")) {
			const parts = path.split(" -> ");
			files.push(parts[0].trim(), parts[1].trim());
			continue;
		}
		files.push(path);
	}
	return files.filter(Boolean);
}

/**
 * The group a file belongs to: its package, or its top directory.
 */
export function moduleOf(file: string): string {
	const parts = file.split("/");
	if (parts[0] === "packages" && parts.length > 1) return `packages/${parts[1]}`;
	return parts[0];
}

/**
 * The extension of a file, without the dot.
 */
export function extensionOf(file: string): string {
	const name = file.split("/").pop() ?? file;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return "";
	return name.slice(dot + 1).toLowerCase();
}

/**
 * Compare two paths.
 */
function comparePaths(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

/**
 * Group the measured files.
 */
export function groupFiles(files: string[]): ScopeWorkGroup[] {
	const groups = new Map<string, string[]>();
	for (const file of files) {
		const id = moduleOf(file);
		const list = groups.get(id) ?? [];
		list.push(file);
		groups.set(id, list);
	}
	return [...groups.entries()]
		.map(([id, groupFiles]) => ({ id, files: groupFiles.sort(comparePaths) }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The number of tracked files that reference the groups.
 *
 * The count is a real count of the files that mention the path of the
 * group, so it is a lower bound of the coupling, not a guess.
 */
function countCallSites(workspacePath: string, groups: ScopeWorkGroup[]): number {
	let count = 0;
	for (const group of groups.slice(0, MAX_REFERENCE_GROUPS)) {
		const out = git(workspacePath, ["grep", "-l", "-F", "--", group.id]);
		if (!out) continue;
		const files = out.split("\n").filter(Boolean);
		// The files of the group mention their own path: they are not
		// references to the group.
		count += files.filter((file) => moduleOf(file) !== group.id).length;
	}
	return count;
}

/**
 * A stable fingerprint of a set of files.
 */
export function fingerprintOf(files: string[]): string {
	const hash = createHash("sha256");
	hash.update([...files].sort(comparePaths).join("\n"));
	return hash.digest("hex").slice(0, 16);
}

/**
 * The path fragments of a request.
 *
 * A hint is a place in the repository that the request names: a path with
 * a separator, or a file name with a known extension. The measurement
 * checks every hint against the tracked files, so a hint that names
 * nothing is simply not used.
 */
export function scopeHintsFromText(text: string): string[] {
	const hints = new Set<string>();
	for (const match of text.match(/[\w.-]+(?:\/[\w.-]+)+/g) ?? []) {
		hints.add(match.replace(/^\.\//, ""));
	}
	for (const match of text.match(/[\w-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|md|py|sh|yaml|yml)\b/g) ?? []) {
		hints.add(match);
	}
	return [...hints].slice(0, 8);
}

/**
 * Measure the scope of a task in the workspace.
 */
export function measureScope(options: MeasureScopeOptions): ScopeMeasurement {
	const workspacePath = options.workspacePath;
	const limit = options.limit ?? DEFAULT_LIMIT;
	const tracked = trackedFiles(workspacePath);
	const hints = (options.hints ?? []).map((hint) => hint.trim()).filter(Boolean);

	// The files the request names: a real match against the tracked paths.
	const matchedHints: string[] = [];
	const named = new Set<string>();
	for (const hint of hints) {
		const needle = hint.toLowerCase();
		let matched = false;
		for (const file of tracked) {
			if (!file.toLowerCase().includes(needle)) continue;
			matched = true;
			if (named.size < limit) named.add(file);
		}
		if (matched) matchedHints.push(hint);
	}

	// The files the session has changed: the scope that is already real.
	const changed = (options.changedFiles ?? changedFiles(workspacePath)).filter((file) =>
		tracked.includes(file),
	);

	let files: string[] = [];
	let source: ScopeMeasurement["source"] = "none";
	if (named.size > 0) {
		files = [...named];
		source = "request";
	} else if (changed.length > 0) {
		files = changed.slice(0, limit);
		source = "working-tree";
	}

	const groups = groupFiles(files);
	const fileTypes: Record<string, number> = {};
	for (const file of files) {
		const extension = extensionOf(file);
		if (!extension) continue;
		fileTypes[extension] = (fileTypes[extension] ?? 0) + 1;
	}

	return {
		files: files.sort(comparePaths),
		groups,
		workspaceFiles: tracked.length,
		callSites: countCallSites(workspacePath, groups),
		fileTypes,
		fingerprint: fingerprintOf(files),
		matchedHints,
		source,
	};
}

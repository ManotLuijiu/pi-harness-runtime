/**
 * Workspace Scanner — Git State Detection
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitState } from "./types.js";

export function isGitRepo(rootPath: string): boolean {
	return existsSync(join(rootPath, ".git"));
}

export function getGitState(rootPath: string): GitState | null {
	if (!isGitRepo(rootPath)) return null;

	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: rootPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const status = execSync("git status --porcelain", {
			cwd: rootPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const lines = status.split("\n").filter(Boolean);
		const modified: string[] = [];
		const untracked: string[] = [];

		for (const line of lines) {
			if (line.startsWith("?? ")) {
				untracked.push(line.slice(3));
			} else if (line.length >= 3) {
				modified.push(line.slice(3));
			}
		}

		let ahead = 0;
		let behind = 0;
		try {
			const revlist = execSync("git rev-list --left-right --count HEAD@{upstream}...HEAD", {
				cwd: rootPath,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			const [a, b] = revlist.split("\t");
			ahead = parseInt(a, 10) || 0;
			behind = parseInt(b, 10) || 0;
		} catch {
			// upstream not configured
		}

		let lastCommitAt: string | undefined;
		try {
			lastCommitAt = execSync("git log -1 --format=%aI", {
				cwd: rootPath,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			// no commits
		}

		return {
			branch,
			isDirty: modified.length > 0 || untracked.length > 0,
			modified,
			untracked,
			ahead,
			behind,
			lastCommitAt,
		};
	} catch {
		return null;
	}
}

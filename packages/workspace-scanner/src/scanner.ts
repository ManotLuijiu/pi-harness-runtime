/**
 * Workspace Scanner — Main Scanner
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGitState, isGitRepo } from "./git.js";
import { detectProject } from "./detect.js";
import type {
	ProjectConfig,
	ScannerOptions,
	WorkspaceSnapshot,
} from "./types.js";

export class WorkspaceScanner {
	private root: string;

	constructor(root: string) {
		this.root = root;
	}

	async scan(opts: ScannerOptions = {}): Promise<WorkspaceSnapshot> {
		const rootPath = opts.rootPath ?? this.root;

		const hasGit = isGitRepo(rootPath);
		const git = !opts.skipGit && hasGit ? getGitState(rootPath) : null;
		const project: ProjectConfig = opts.skipConfig
			? {}
			: detectProject(rootPath);

		const envFiles: string[] = [];
		const configFiles: string[] = [];

		if (!opts.skipConfig) {
			for (const name of [
				".env",
				".env.local",
				".env.example",
				".env.production",
			]) {
				if (existsSync(join(rootPath, name))) envFiles.push(name);
			}
			for (const name of [
				"tsconfig.json",
				"jsconfig.json",
				"vite.config.ts",
				"next.config.js",
				"nuxt.config.ts",
				"eslint.config.js",
			]) {
				if (existsSync(join(rootPath, name))) configFiles.push(name);
			}
		}

		return {
			root: rootPath,
			git,
			project,
			envFiles,
			configFiles,
			hasGit,
			hasNode: existsSync(join(rootPath, "package.json")),
			hasPython: existsSync(join(rootPath, "pyproject.toml")),
		};
	}
}

export function scanWorkspace(
	rootPath: string,
	opts: ScannerOptions = {},
): Promise<WorkspaceSnapshot> {
	return new WorkspaceScanner(rootPath).scan(opts);
}

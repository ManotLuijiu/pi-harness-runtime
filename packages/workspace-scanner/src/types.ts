/**
 * Workspace Scanner — Types
 */

export interface GitState {
	branch: string;
	isDirty: boolean;
	modified: string[];
	untracked: string[];
	ahead: number;
	behind: number;
	lastCommitAt?: string;
}

export interface ProjectConfig {
	name?: string;
	packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "pip" | "go" | "cargo" | "maven" | "gradle" | "composer";
	language?: string;
	framework?: string;
	buildTool?: string;
}

export interface ScannerOptions {
	rootPath?: string;
	skipGit?: boolean;
	skipConfig?: boolean;
}

export interface WorkspaceSnapshot {
	root: string;
	git: GitState | null;
	project: ProjectConfig;
	envFiles: string[];
	configFiles: string[];
	hasGit: boolean;
	hasNode: boolean;
	hasPython: boolean;
}

/**
 * Release Manager — Types (RFC-0078)
 */

export type SemVerPart = "major" | "minor" | "patch";

export interface Version {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
	build?: string;
}

export interface ChangelogEntry {
	version: string;
	date: string;
	type: "major" | "minor" | "patch" | "prerelease" | "build";
	changes: ChangelogChanges;
	breaking?: boolean;
	security?: boolean;
	authors?: string[];
}

export interface ChangelogChanges {
	added: string[];
	changed: string[];
	deprecated: string[];
	removed: string[];
	fixed: string[];
	security: string[];
}

export interface Commit {
	hash: string;
	message: string;
	author: string;
	date: string;
	type:
		| "feat"
		| "fix"
		| "docs"
		| "style"
		| "refactor"
		| "perf"
		| "test"
		| "chore"
		| "break"
		| "build";
}

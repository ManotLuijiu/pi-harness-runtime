/**
 * The types of the sensitive term check.
 *
 * The check is a plain JavaScript module on purpose: the pre-push hook
 * runs it on the machine of a user who may have no build tools at all,
 * and the workflow runs it with the node of the runner. A TypeScript
 * source would ask both for a compiler they do not have.
 *
 * The declarations live here so that the TypeScript side of the
 * repository - the package verification - can use the check without
 * knowing anything about JavaScript.
 */

/** A place where a term was found. The path and the line, and nothing else. */
export interface SensitiveHit {
	/** The path of the file, relative to the scanned root. */
	path: string;
	/** The line of the hit. 0 when the path itself holds the term. */
	line: number;
}

/** What a scan found. */
export interface SensitiveScanResult {
	/** Every place a term was found. */
	hits: SensitiveHit[];
	/** How many files were looked at. */
	scanned: number;
	/** What was scanned, in words. */
	mode: string;
}

/** The terms of a list: one term per line, empty lines and comments skipped. */
export function parseTerms(text: string): string[];

/** The terms of a file. A file that cannot be read is no terms. */
export function readTermsFile(path: string | undefined): string[];

/** The repository of a checkout, from its origin remote. */
export function repositoryFromRemote(cwd?: string): string | null;

/** The terms of the environment: SENSITIVE_TERMS, or PI_SENSITIVE_TERMS_FILE. */
export function termsFromEnv(env?: Record<string, string | undefined>): string[];

/** Does a line hold one of the terms? A plain, case-insensitive fragment. */
export function lineHasTerm(line: string, terms: string[]): boolean;

/** The added lines of a unified diff, with the line they have in the new file. */
export function addedLines(patch: string): { line: number; text: string }[];

/** The lines of a whole file. */
export function fileLines(content: string): { line: number; text: string }[];

/** Does a path hold a term? */
export function pathHasTerm(path: string, terms: string[]): boolean;

/** Hide the terms in a text. */
export function redactTerms(text: string, terms: string[]): string;

/** Scan a unified diff for the terms. */
export function scanPatch(patch: string, path: string, terms: string[]): SensitiveHit[];

/** Scan a whole text for the terms. */
export function scanText(text: string, path: string, terms: string[]): SensitiveHit[];

/** The report of a scan. It names the places and never a term. */
export function formatReport(args: {
	hits: SensitiveHit[];
	scanned: number;
	mode: string;
	terms?: string[];
}): string;

/** The files of a directory tree. A symlink is not followed. */
export function listTreeFiles(
	dir: string,
	root?: string,
	out?: { relative: string; absolute: string }[],
): { relative: string; absolute: string }[];

/** Scan a directory tree for the terms. */
export function scanTree(dir: string, terms: string[]): SensitiveScanResult;

/** Scan a range of commits for the terms. */
export function scanRange(
	range: string,
	terms: string[],
	cwd?: string,
): SensitiveScanResult;

/** The exit code of a clean run. */
export const EXIT_CLEAN: number;
/** The exit code of a run that found a term. */
export const EXIT_FOUND: number;
/** The exit code of a run that could not check anything. */
export const EXIT_UNAVAILABLE: number;

/**
 * Resolve the relative imports of a published file.
 *
 * The published package is a single app: every internal package lives in
 * `packages/<name>/` and the runtime reaches it through relative paths. A
 * relative import that does not resolve is a broken module graph, and a
 * consumer finds out when the import runs - long after the release.
 *
 * The check that used to guard this only followed specifiers that contained
 * "packages/", so an import inside a package (`./locks.js`) was never
 * looked at, and the compiled output was never scanned at all. That gap
 * let a package whose entry point could not be imported ship.
 *
 * The rules:
 *
 *   1. A TYPE-only import is erased at runtime, so it does not need a
 *      runtime target. It is skipped.
 *   2. Comments are removed before the scan, so a commented-out import is
 *      not a broken import.
 *   3. A relative import resolves when the target file exists:
 *        - the specifier as written (`./x.js` -> `x.js`),
 *        - the TypeScript source of a `.js` specifier (`./x.js` -> `x.ts`),
 *          because the compiler and the Bun runtime map it, or
 *        - a directory entry point (`./x` -> `x/index.js`).
 *   4. A compiled file (`.js`) must reach a file that is PUBLISHED. A
 *      TypeScript source (`.ts`) is resolved at compile time, so it may
 *      reach a source file in the repository.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** The quoting state of the comment scanner. */
type Quote = "" | '"' | "'" | "`";

/**
 * Remove the comments from a source file.
 *
 * A string or a template literal may contain something that looks like a
 * comment, so the scanner tracks the quoting state instead of using a
 * regular expression.
 */
export function stripComments(source: string): string {
	let out = "";
	let i = 0;
	let quote: Quote = "";

	while (i < source.length) {
		const char = source[i];
		const next = source[i + 1];

		if (quote) {
			out += char;
			if (char === "\\") {
				// An escaped character cannot end the literal.
				out += next ?? "";
				i += 2;
				continue;
			}
			if (char === quote) quote = "";
			i += 1;
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			i += 1;
			continue;
		}

		if (char === "/" && next === "/") {
			// A line comment runs to the end of the line.
			while (i < source.length && source[i] !== "\n") i += 1;
			continue;
		}

		if (char === "/" && next === "*") {
			// A block comment runs to its closing marker.
			const end = source.indexOf("*/", i + 2);
			if (end === -1) {
				i = source.length;
				break;
			}
			// Keep the newlines, so a line number stays meaningful.
			for (let k = i; k < end; k += 1) {
				if (source[k] === "\n") out += "\n";
			}
			i = end + 2;
			continue;
		}

		out += char;
		i += 1;
	}

	return out;
}

/**
 * Every RELATIVE value import of a source file.
 *
 * A type-only import is skipped: `import type { X } from "..."` is erased
 * by the compiler and never reaches the runtime.
 */
export function extractRelativeValueImports(source: string): string[] {
	const code = stripComments(source);
	const specifiers: string[] = [];

	const patterns: RegExp[] = [
		// import ... from "..." / export ... from "..."
		/(?:^|[\n;])[ \t]*(import|export)\s+(type\s+)?[^;\n]*?from\s*["']([^"']+)["']/g,
		// import "..." (side effect)
		/(?:^|[\n;])[ \t]*import\s*["']([^"']+)["']/g,
		// import("...") (dynamic)
		/import\s*\(\s*["']([^"']+)["']\s*\)/g,
	];

	for (const pattern of patterns) {
		for (const match of code.matchAll(pattern)) {
			// `type` marks an import that the compiler erases.
			if (match[2] && match[2].trim() === "type") continue;
			const specifier = match[3] ?? match[1];
			if (!specifier) continue;
			if (!specifier.startsWith(".")) continue;
			specifiers.push(specifier);
		}
	}

	return [...new Set(specifiers)];
}

/**
 * The files a relative specifier may point at.
 *
 * The candidates are absolute paths, most specific first.
 */
export function importTargetCandidates(
	importer: string,
	specifier: string,
): string[] {
	const base = resolve(dirname(importer), specifier);
	const candidates = [base];
	if (base.endsWith(".js")) candidates.push(`${base.slice(0, -3)}.ts`);
	candidates.push(`${base}.js`, `${base}.ts`);
	candidates.push(`${base}/index.js`, `${base}/index.ts`);
	return [...new Set(candidates)];
}

/** The result of resolving one relative import. */
export interface ResolvedImport {
	ok: boolean;
	/** The file the import points at, when one was found. */
	target?: string;
	/** Why the import does not resolve. */
	reason?: string;
}

/** The options of {@link resolveRelativeImport}. */
export interface ResolveOptions {
	/** Absolute path of the importing file. */
	importer: string;
	/** The relative specifier. */
	specifier: string;
	/** Existence test, overridable for a test. */
	exists?: (path: string) => boolean;
	/** Publication test, overridable for a test. */
	isPublished?: (path: string) => boolean;
}

/**
 * Resolve one relative import.
 */
export function resolveRelativeImport({
	importer,
	specifier,
	exists = existsSync,
	isPublished = () => true,
}: ResolveOptions): ResolvedImport {
	const candidates = importTargetCandidates(importer, specifier);
	const found = candidates.find((candidate) => {
		try {
			return exists(candidate) && statSync(candidate).isFile();
		} catch {
			return false;
		}
	});
	if (!found) {
		return { ok: false, reason: "the target does not exist" };
	}
	// A compiled file has to reach a published file: a consumer never sees
	// the repository. A TypeScript source is resolved by the compiler, so it
	// may point at a source file in the repository.
	const isCompiled = /\.(js|mjs|cjs)$/.test(importer);
	if (isCompiled && !isPublished(found)) {
		return { ok: false, target: found, reason: "the target is not published" };
	}
	return { ok: true, target: found };
}

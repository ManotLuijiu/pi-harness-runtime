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
 *      not a broken import. The same holds for text inside a string or a
 *      template literal: documentation that shows an import is not an
 *      import.
 *   3. A relative import resolves when the target file exists:
 *        - the specifier as written (`./x.js` -> `x.js`),
 *        - the TypeScript source of a `.js` specifier (`./x.js` -> `x.ts`),
 *          because the compiler and the Bun runtime map it, or
 *        - a directory entry point (`./x` -> `x/index.js`).
 *   4. A compiled file (`.js`) must reach a file that is PUBLISHED. A
 *      TypeScript source (`.ts`) is resolved at compile time, so it may
 *      reach a source file in the repository.
 *   5. A bare import that names a WORKSPACE package cannot resolve: the
 *      workspace packages ship inside this one tarball and are never
 *      installed as separate packages, so the name does not exist at
 *      runtime. Such an import must point at the built artifact instead.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** The quoting state of the scanner. */
type Quote = "" | '"' | "'" | "`";

/** A source with its comments removed and its string content marked. */
export interface ScannedSource {
	/** The source without its comments. */
	code: string;
	/**
	 * Whether the character at the given index of {@link code} is code.
	 *
	 * The content of a string or a template literal is not code, so an
	 * import that only appears inside one is documentation, not an import.
	 */
	isCodeAt: (index: number) => boolean;
}

/**
 * Remove the comments from a source file and mark its string content.
 *
 * A string or a template literal may contain something that looks like a
 * comment, so the scanner tracks the quoting state instead of using a
 * regular expression.
 */
export function scanSource(source: string): ScannedSource {
	let code = "";
	const isCode: boolean[] = [];
	let i = 0;
	let quote: Quote = "";

	const emit = (char: string, isCodeChar: boolean) => {
		code += char;
		isCode.push(isCodeChar);
	};

	while (i < source.length) {
		const char = source[i];
		const next = source[i + 1];

		if (quote) {
			// The content of a literal is not code. The quotes are.
			emit(char, char === quote && source[i - 1] !== "\\");
			if (char === "\\") {
				// An escaped character cannot end the literal.
				emit(next ?? "", false);
				i += 2;
				continue;
			}
			if (char === quote) quote = "";
			i += 1;
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			emit(char, true);
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
				if (source[k] === "\n") emit("\n", false);
			}
			i = end + 2;
			continue;
		}

		emit(char, true);
		i += 1;
	}

	return { code, isCodeAt: (index: number) => isCode[index] === true };
}

/**
 * Remove the comments from a source file.
 */
export function stripComments(source: string): string {
	return scanSource(source).code;
}

/** The STATIC import forms that carry a specifier. */
const STATIC_IMPORT_PATTERNS: RegExp[] = [
	// import ... from "..." / export ... from "..."
	/(?:^|[\n;])[ \t]*(import|export)\s+(type\s+)?[^;\n]*?from\s*["']([^"']+)["']/g,
	// import "..." (side effect)
	/(?:^|[\n;])[ \t]*import\s*["']([^"']+)["']/g,
];

/** The DYNAMIC import form that carries a specifier. */
const DYNAMIC_IMPORT_PATTERNS: RegExp[] = [
	// import("...") (dynamic)
	/import\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** The import forms that carry a specifier. */
const IMPORT_PATTERNS: RegExp[] = [
	...STATIC_IMPORT_PATTERNS,
	...DYNAMIC_IMPORT_PATTERNS,
];

/**
 * Every VALUE import of a source file.
 *
 * A type-only import is skipped: `import type { X } from "..."` is erased
 * by the compiler and never reaches the runtime. An import that only
 * appears inside a string or a template literal is skipped as well: that
 * is documentation, not an import.
 */
export function extractValueImports(source: string): string[] {
	return collectSpecifiers(source, IMPORT_PATTERNS);
}

/**
 * Every STATIC value import of a source file.
 *
 * A dynamic import is a different thing: it is resolved when the code
 * reaches it, so a module that loads one at run time may be an optional
 * dependency. A static import is resolved when the module is loaded, so
 * the package must carry it.
 */
export function extractStaticValueImports(source: string): string[] {
	return collectSpecifiers(source, STATIC_IMPORT_PATTERNS);
}

/** The specifiers of the given import forms. */
function collectSpecifiers(source: string, patterns: RegExp[]): string[] {
	const { code, isCodeAt } = scanSource(source);
	const specifiers: string[] = [];

	for (const pattern of patterns) {
		for (const match of code.matchAll(pattern)) {
			// The match must start in code, not inside a literal.
			if (match.index === undefined || !isCodeAt(match.index)) continue;
			// `type` marks an import that the compiler erases.
			if (match[2] && match[2].trim() === "type") continue;
			const specifier = match[3] ?? match[1];
			if (!specifier) continue;
			specifiers.push(specifier);
		}
	}

	return [...new Set(specifiers)];
}

/**
 * Every RELATIVE value import of a source file.
 */
export function extractRelativeValueImports(source: string): string[] {
	return extractValueImports(source).filter((specifier) => specifier.startsWith("."));
}

/**
 * Every BARE value import of a source file.
 *
 * A bare import names a package, not a file in this repository.
 */
export function extractBareImports(source: string): string[] {
	return extractValueImports(source).filter((specifier) => !specifier.startsWith("."));
}

/**
 * Every STATIC bare value import of a source file.
 *
 * A static bare import is a package the module needs when it is loaded.
 * The published package must declare it, or the consumer cannot import
 * the module at all.
 */
export function extractStaticBareImports(source: string): string[] {
	return extractStaticValueImports(source).filter(
		(specifier) => !specifier.startsWith("."),
	);
}

/**
 * The package a specifier names.
 *
 * `@scope/name/sub/path` and `name/sub/path` both name `@scope/name` and
 * `name`.
 */
export function packageNameOf(specifier: string): string {
	if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
	return specifier.split("/")[0];
}

/** Is the character part of an identifier? */
function isWordChar(char: string | undefined): boolean {
	return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/**
 * Every `require(...)` call that runs when the module is loaded.
 *
 * The published package is an ES module (`"type": "module"`), and Node has
 * no `require` in an ES module. A `require` in the body of a function is
 * harmless as long as nobody calls that function - but a `require` at the
 * top level of the module throws the moment the module is imported.
 *
 * The scanner walks the code and counts the braces, so it knows whether a
 * call sits inside a function body. The content of a string or a template
 * literal is not code and is skipped.
 */
/**
 * The blocks that are not a function body.
 *
 * A `require` inside one of them still runs when the module is loaded:
 * `if (cond) { require("x") }` is a load time call, not a call that waits
 * for a function to run.
 */
const LOAD_TIME_BLOCK_KEYWORDS =
	/^(?:if|for|while|switch|try|catch|finally|do|else|class|enum)\b/;

/**
 * A `require` call in a source file.
 */
export interface RequireCall {
	/** The module the call names. */
	specifier: string;
	/** Whether the call runs when the module is loaded. */
	moduleScope: boolean;
}

/**
 * Every `require` call of a source file.
 *
 * The scope analysis is textual: a block opens a function scope unless it
 * belongs to a statement that runs at load time, and an arrow function
 * with an expression body ends with its statement.
 */
export function findRequireCalls(source: string): RequireCall[] {
	const { code, isCodeAt } = scanSource(source);
	const calls: RequireCall[] = [];
	let functionDepth = 0;
	let arrowDepth = 0;

	for (let i = 0; i < code.length; i += 1) {
		if (!isCodeAt(i)) continue;
		const char = code[i];
		if (char === "{") {
			if (!opensLoadTimeBlock(code, i)) functionDepth += 1;
			continue;
		}
		if (char === "}") {
			functionDepth -= 1;
			continue;
		}
		if (char === ";" && functionDepth === 0) {
			// The end of a statement ends an arrow function whose body is
			// an expression: `const load = () => require("x");`.
			arrowDepth = 0;
			continue;
		}
		if (char === "=" && code[i + 1] === ">") {
			if (functionDepth === 0) arrowDepth += 1;
			i += 1;
			continue;
		}
		if (!code.startsWith("require", i)) continue;
		if (isWordChar(code[i - 1]) || isWordChar(code[i + 7])) continue;
		let j = i + 7;
		while (j < code.length && /\s/.test(code[j])) j += 1;
		if (code[j] !== "(") continue;
		const end = code.indexOf(")", j);
		const argument = code.slice(j + 1, end === -1 ? j + 1 : end).trim();
		// A call inside a call at the top level still runs at load time.
		const moduleScope = functionDepth === 0 && arrowDepth === 0;
		calls.push({ specifier: unquoteSpecifier(argument), moduleScope });
		i = j;
	}

	return calls;
}

/**
 * Every `require` that runs when the module is loaded.
 *
 * The published package is an ES module and Node has no `require` there:
 * a call at the top level of a module throws the moment the module is
 * imported. A `require` inside a function body only runs when that
 * function runs, so it is not a problem for the import itself.
 */
export function findModuleScopeRequires(source: string): string[] {
	return findRequireCalls(source)
		.filter((call) => call.moduleScope)
		.map((call) => call.specifier);
}

/**
 * Whether the file creates its own `require`.
 *
 * An ES module has no `require`, but a module that builds one with
 * `createRequire` owns a working `require`. Such a file is not broken by
 * a `require` call.
 */
export function hasLocalRequire(source: string): boolean {
	return /(?:const|let|var)\s+require\s*=\s*createRequire\s*\(/.test(source);
}

/**
 * Whether the block that starts at the given position runs at load time.
 *
 * The text between the block and the statement before it names the kind of
 * the block: `try {` is a load time block, `function read() {` is a
 * function scope.
 */
function opensLoadTimeBlock(code: string, braceIndex: number): boolean {
	let start = braceIndex - 1;
	while (start >= 0) {
		const char = code[start];
		if (char === ";" || char === "{" || char === "}") {
			start += 1;
			break;
		}
		start -= 1;
	}
	if (start < 0) start = 0;
	const statement = code.slice(start, braceIndex).trim();
	return LOAD_TIME_BLOCK_KEYWORDS.test(statement);
}

/** Remove the quotes of a module specifier. */
function unquoteSpecifier(specifier: string): string {
	if (specifier.length < 2) return specifier;
	const first = specifier[0];
	const last = specifier[specifier.length - 1];
	if ((first === '"' || first === "'") && first === last) {
		return specifier.slice(1, -1);
	}
	return specifier;
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

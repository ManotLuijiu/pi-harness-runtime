/**
 * Every relative import of a published file must resolve.
 *
 * The published app is a SINGLE npm package. Every internal app lives in
 * `packages/<name>/` and the runtime reaches it through relative paths, so
 * a relative import that does not resolve is a module graph that breaks
 * when it runs - in a consumer's installation, long after the release.
 *
 * The check that used to guard this only followed specifiers that contained
 * "packages/", so an import INSIDE a package (`./locks.js`) was never
 * looked at, and the compiled output was never scanned at all. That gap let
 * a package whose entry point could not be imported reach the registry.
 *
 * The rules the guard applies:
 *
 *   1. A type-only import is erased by the compiler, so it needs no runtime
 *      target and is skipped.
 *   2. Comments are removed before the scan, so a commented-out import is
 *      not a broken import.
 *   3. A relative import resolves when the target exists: as written, as the
 *      TypeScript source of a `.js` specifier, or as a directory entry point.
 *   4. A compiled file (`.js`) must reach a PUBLISHED file - a consumer never
 *      sees the repository. A TypeScript source is resolved at compile time,
 *      so it may reach a source file in the repository.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	extractBareImports,
	extractRelativeValueImports,
	extractValueImports,
	packageNameOf,
	resolveRelativeImport,
	stripComments,
	// The helper is a repository script, not a published package, and the
	// repository does not compile it. The ".js" specifier therefore has
	// no file behind it outside bun, which maps the specifier to the
	// TypeScript source. Naming the source keeps the test runnable under
	// node as well, the way the other test files name their sources.
} from "../scripts/lib/runtime-imports.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The files that may carry an import. */
function isScannable(file) {
	if (!/\.(ts|mts|cts|mjs|js|cjs)$/.test(file)) return false;
	if (file.endsWith(".d.ts") || file.endsWith(".d.mts")) return false;
	return true;
}

/** The repository's tracked files, or null when this is not a Git checkout. */
function trackedFiles() {
	try {
		const out = execFileSync("git", ["ls-files"], {
			cwd: ROOT,
			encoding: "utf8",
		});
		return out.split("\n").filter(Boolean);
	} catch {
		return null;
	}
}

/**
 * The files npm would publish.
 *
 * The list comes from npm itself, so the check sees what a consumer gets.
 */
function publishedFiles() {
	try {
		const out = execFileSync(
			"npm",
			["pack", "--dry-run", "--json", "--ignore-scripts"],
			{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
		);
		const parsed = JSON.parse(out);
		const entries = Array.isArray(parsed) ? parsed : [parsed];
		return entries.flatMap((entry) => entry?.files ?? []).map((file) => file.path);
	} catch {
		return null;
	}
}

/**
 * The names of the workspace packages.
 *
 * They ship inside this one tarball and are never installed as separate
 * packages, so a bare import that names one of them cannot resolve.
 */
function workspacePackageNames() {
	const names = new Set();
	const packagesDir = join(ROOT, "packages");
	if (!existsSync(packagesDir)) return names;
	for (const name of readdirSync(packagesDir)) {
		const manifestPath = join(packagesDir, name, "package.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (manifest.name) names.add(manifest.name);
		} catch {
			// A manifest that cannot be read names no package.
		}
	}
	return names;
}

/**
 * Every bare import of the given files that names a workspace package.
 */
function bareWorkspaceImports(files) {
	const workspace = workspacePackageNames();
	const problems = [];
	for (const file of files) {
		if (!isScannable(file)) continue;
		const full = join(ROOT, file);
		if (!existsSync(full)) continue;
		const content = readFileSync(full, "utf8");
		for (const specifier of extractBareImports(content)) {
			const name = packageNameOf(specifier);
			if (!workspace.has(name)) continue;
			problems.push(`${file} imports ${specifier} but ${name} is never installed`);
		}
	}
	return problems;
}

/**
 * Every relative import of the given files that does not resolve.
 *
 * @param {string[]} files The files to scan, relative to the repository root.
 * @param {Set<string>} published The files a consumer receives.
 * @returns {string[]} One line per broken import.
 */
function brokenImports(files, published) {
	const problems = [];
	for (const file of files) {
		if (!isScannable(file)) continue;
		const full = join(ROOT, file);
		if (!existsSync(full)) continue;
		const content = readFileSync(full, "utf8");
		for (const specifier of extractRelativeValueImports(content)) {
			const result = resolveRelativeImport({
				importer: full,
				specifier,
				exists: existsSync,
				isPublished: (candidate) =>
					published.has(relative(ROOT, candidate).split("\\").join("/")),
			});
			if (!result.ok) {
				problems.push(`${file} imports ${specifier} but ${result.reason}`);
			}
		}
	}
	return problems;
}

test("a comment is not an import", () => {
	const source = [
		"// import { a } from './commented-out.js';",
		"/*",
		"import { b } from './also-commented-out.js';",
		"*/",
		"import { c } from './real.js';",
	].join("\n");
	assert.equal(
		stripComments(source).includes("commented-out"),
		false,
		"the comments must be gone",
	);
	assert.deepEqual(extractRelativeValueImports(source), ["./real.js"]);
});

test("a string that looks like a comment is not a comment", () => {
	const source = `const note = "// not a comment";\nimport { a } from "./real.js";`;
	assert.deepEqual(extractRelativeValueImports(source), ["./real.js"]);
});

test("a type-only import is not a runtime import", () => {
	const source = [
		'import type { JobStateMachine } from "../../harness/job-state-machine.js";',
		'import { runJob } from "./runner.js";',
		'export type { Options } from "./options.js";',
	].join("\n");
	assert.deepEqual(extractRelativeValueImports(source), ["./runner.js"]);
});

test("a bare specifier is not a relative import", () => {
	const source = [
		'import { readFile } from "node:fs/promises";',
		'import { thing } from "@pi-harness/skills";',
		'import("./dynamic.js");',
	].join("\n");
	assert.deepEqual(extractRelativeValueImports(source), ["./dynamic.js"]);
});

test("a relative import resolves to the file, the source or the entry point", () => {
	const dir = mkdtempSync(join(tmpdir(), "runtime-imports-"));
	writeFileSync(join(dir, "plain.js"), "export const a = 1;\n");
	writeFileSync(join(dir, "typed.ts"), "export const b = 1;\n");
	mkdirSync(join(dir, "folder"));
	writeFileSync(join(dir, "folder", "index.js"), "");
	const importer = join(dir, "importer.js");

	const exact = resolveRelativeImport({
		importer,
		specifier: "./plain.js",
		exists: existsSync,
	});
	assert.equal(exact.ok, true);
	assert.equal(exact.target, join(dir, "plain.js"));

	// A `.js` specifier also reaches the TypeScript source of that name.
	const typed = resolveRelativeImport({
		importer,
		specifier: "./typed.js",
		exists: existsSync,
	});
	assert.equal(typed.ok, true);
	assert.equal(typed.target, join(dir, "typed.ts"));

	const folder = resolveRelativeImport({
		importer,
		specifier: "./folder",
		exists: existsSync,
	});
	assert.equal(folder.ok, true);
	assert.equal(folder.target, join(dir, "folder", "index.js"));

	const missing = resolveRelativeImport({
		importer,
		specifier: "./not-there.js",
		exists: existsSync,
	});
	assert.equal(missing.ok, false);
	assert.match(missing.reason, /does not exist/);
});

test("a compiled file must reach a published file", () => {
	const dir = mkdtempSync(join(tmpdir(), "runtime-imports-"));
	writeFileSync(join(dir, "published.js"), "");
	writeFileSync(join(dir, "private.js"), "");
	const importer = join(dir, "importer.js");

	const published = resolveRelativeImport({
		importer,
		specifier: "./published.js",
		exists: existsSync,
		isPublished: (candidate) => candidate === join(dir, "published.js"),
	});
	assert.equal(published.ok, true);

	const privateTarget = resolveRelativeImport({
		importer,
		specifier: "./private.js",
		exists: existsSync,
		isPublished: (candidate) => candidate === join(dir, "published.js"),
	});
	assert.equal(privateTarget.ok, false);
	assert.match(privateTarget.reason, /not published/);

	// A TypeScript source is resolved at compile time, so it may reach a
	// source file that is not published.
	const source = resolveRelativeImport({
		importer: join(dir, "importer.ts"),
		specifier: "./private.js",
		exists: existsSync,
		isPublished: () => false,
	});
	assert.equal(source.ok, true);
});

test("an import inside a template literal is documentation, not an import", () => {
	const source = [
		"const doc = `",
		"## Usage",
		"",
		"\\`\\`\\`typescript",
		'import { WebMCPTester } from "@pi-harness/e2e-tester";',
		"\\`\\`\\`",
		"`;",
		'import { run } from "./runner.js";',
	].join("\n");
	assert.deepEqual(extractValueImports(source), ["./runner.js"]);
});

test("a bare import is separated from a relative one", () => {
	const source = [
		'import { readFile } from "node:fs/promises";',
		'import { skill } from "@pi-harness/skills";',
		'import { local } from "./local.js";',
	].join("\n");
	assert.deepEqual(extractBareImports(source), ["node:fs/promises", "@pi-harness/skills"]);
	assert.deepEqual(extractRelativeValueImports(source), ["./local.js"]);
	assert.equal(packageNameOf("@pi-harness/skills"), "@pi-harness/skills");
	assert.equal(packageNameOf("@pi-harness/skills/sub/path.js"), "@pi-harness/skills");
	assert.equal(packageNameOf("zod"), "zod");
});

/**
 * The two published-file tests pack the whole application and read the
 * tarball. That takes several seconds, and the runner's default per-test
 * timeout is five seconds - enough on a fast machine, not enough on a
 * slow one. The timeout is stated per test so that a slow runner never
 * decides which assertion runs.
 */
const TEST_TIMEOUT_MS = 120_000;

test("no tracked file names a workspace package in a bare import", { timeout: TEST_TIMEOUT_MS }, () => {
	const files = trackedFiles();
	if (files === null) {
		return; // not a Git checkout - nothing to scan
	}
	assert.deepEqual(bareWorkspaceImports(files), []);
});

test("no published file names a workspace package in a bare import", { timeout: TEST_TIMEOUT_MS }, () => {
	const files = publishedFiles();
	if (files === null) {
		return; // npm is not available - the CI verifier covers it
	}
	assert.deepEqual(bareWorkspaceImports(files), []);
});

test("no tracked file carries a relative import that does not resolve", { timeout: TEST_TIMEOUT_MS }, () => {
	const files = trackedFiles();
	if (files === null) {
		return; // not a Git checkout - nothing to scan
	}
	const tracked = new Set(files);
	assert.deepEqual(brokenImports(files, tracked), []);
});

test("no published file carries a relative import that does not resolve", { timeout: TEST_TIMEOUT_MS }, () => {
	const files = publishedFiles();
	if (files === null) {
		return; // npm is not available - the CI verifier covers it
	}
	const published = new Set(files);
	assert.deepEqual(brokenImports(files, published), []);
});

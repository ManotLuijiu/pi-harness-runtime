/**
 * The sensitive term check must catch a name, and it must not become the
 * place where the name leaks a second time.
 *
 * The check runs in a public workflow log, and the log is public. A report
 * that prints the term - or the line that held it - would put the name
 * into a place that the pull request did not own. So the report names the
 * path and the line number, which the pull request already shows, and
 * nothing else.
 *
 * The term in this file is a placeholder. A real client name in a test of
 * the check that keeps client names out would be the exact mistake the
 * check exists to prevent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
	parseTerms,
	readTermsFile,
	termsFromEnv,
	lineHasTerm,
	addedLines,
	scanPatch,
	scanText,
	pathHasTerm,
	redactTerms,
	formatReport,
	scanPullRequest,
	repositoryFromRemote,
	EXIT_CLEAN,
	EXIT_FOUND,
	EXIT_UNAVAILABLE,
} from "../scripts/check-sensitive-terms.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SCANNER = join(ROOT, "scripts", "check-sensitive-terms.mjs");

/** A term that is not a real name. */
const TERM = "zzplaceholdername";
const TERMS = [TERM];

test("a term list is one term per line, and a comment is not a term", () => {
	const terms = parseTerms(`\n  ${TERM}  \n# a comment\n\n${TERM.toUpperCase()}\nother\n`);
	assert.deepEqual(terms, [TERM, "other"]);
});

test("a term is matched as a plain fragment, without a word boundary", () => {
	// A name appears inside identifiers and inside file names. A word
	// boundary would miss exactly those.
	assert.equal(lineHasTerm(`const ${TERM}_client = 1;`, TERMS), true);
	assert.equal(lineHasTerm(`some/${TERM}/notes.md`, TERMS), true);
	assert.equal(lineHasTerm(`${TERM.toUpperCase()}`, TERMS), true);
	assert.equal(lineHasTerm("nothing to see here", TERMS), false);
});

test("only the added lines of a diff are scanned, with their new line numbers", () => {
	const patch = [
		"@@ -10,3 +10,4 @@",
		" context one",
		" context two",
		`- a removed line with ${TERM}`,
		`+ an added line with ${TERM}`,
		" context three",
	].join("\n");
	const added = addedLines(patch);
	assert.equal(added.length, 1);
	// The hunk starts at line 10 of the new file. Two context lines
	// take 10 and 11, a removed line takes nothing, so the added line
	// is 12.
	assert.equal(added[0].line, 12);
	assert.equal(added[0].text.includes(TERM), true);
});

test("a removed line is not a hit, so a cleanup can be merged", () => {
	const patch = [`@@ -1,2 +1,1 @@`, `- removed ${TERM}`, "+ kept"];
	const hits = scanPatch(patch, "src/file.ts", TERMS);
	assert.deepEqual(hits, []);
});

test("an added line is a hit, and the path is reported with the line number", () => {
	const patch = ["@@ -1,1 +1,2 @@", "+ first", `+ second ${TERM}`].join("\n");
	const hits = scanPatch(patch, "src/file.ts", TERMS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].path, "src/file.ts");
	assert.equal(hits[0].line, 2);
});

test("a path that holds a term is a hit even when no line does", () => {
	// A file that was only renamed keeps its content and changes its
	// path. The diff shows no added line, but the name is now in the
	// repository.
	const hits = scanPatch("@@ -0,0 +1,1 @@\n+ unchanged", `docs/${TERM}.md`, TERMS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].line, 0);
	assert.equal(pathHasTerm(`docs/${TERM}.md`, TERMS), true);
	assert.equal(pathHasTerm("docs/plain.md", TERMS), false);
});

test("a whole file is scanned line by line", () => {
	const hits = scanText(`one\ntwo ${TERM}\nthree`, "src/file.ts", TERMS);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].line, 2);
});

test("the report never holds the term and never holds the line that matched", () => {
	const report = formatReport({
		hits: [{ path: "src/file.ts", line: 7 }],
		scanned: 3,
		mode: "files",
		terms: TERMS,
	});
	assert.equal(report.includes(TERM), false);
	assert.equal(report.includes("src/file.ts:7"), true);
});

test("a path that holds a term is printed with the term hidden", () => {
	// The path can be the place the term is in. Printing the path as
	// it is would print the term with it - in a public log.
	const report = formatReport({
		hits: [{ path: `docs/${TERM}.md`, line: 0 }],
		scanned: 1,
		mode: "files",
		terms: TERMS,
	});
	assert.equal(report.includes(TERM), false);
	assert.match(report, /docs\/\*\*\*\.md:0/);
});

test("a term is hidden in a text, wherever it stands", () => {
	assert.equal(redactTerms(`a ${TERM} b`, TERMS), "a *** b");
	assert.equal(redactTerms(`${TERM.toUpperCase()}`, TERMS), "***");
	// A term with a character that means something in a pattern.
	assert.equal(redactTerms("a.c and axc", ["a.c"]), "*** and axc");
	assert.equal(redactTerms("nothing here", TERMS), "nothing here");
});

test("a clean report says so", () => {
	const report = formatReport({ hits: [], scanned: 12, mode: "files" });
	assert.match(report, /no sensitive term was found/);
	assert.equal(report.includes(TERM), false);
});

test("an empty list is not a clean run, it is no run at all", () => {
	assert.deepEqual(parseTerms(""), []);
	assert.deepEqual(termsFromEnv({}), []);
	assert.deepEqual(termsFromEnv({ SENSITIVE_TERMS: "" }), []);
	// A named file that cannot be read is no terms.
	assert.deepEqual(readTermsFile("/nonexistent/terms.txt"), []);
});

test("the terms come from the environment when there is no file", () => {
	const terms = termsFromEnv({ SENSITIVE_TERMS: `${TERM}\nsecond` });
	assert.deepEqual(terms, [TERM, "second"]);
	// The local file is the fallback.
	const dir = mkdtempSync(join(tmpdir(), "terms-"));
	const file = join(dir, "terms.txt");
	writeFileSync(file, `${TERM}\n`);
	try {
		assert.deepEqual(termsFromEnv({ PI_SENSITIVE_TERMS_FILE: file }), [TERM]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the command line finds a term and keeps it out of the output", () => {
	const dir = mkdtempSync(join(tmpdir(), "scan-"));
	const termsFile = join(dir, "terms.txt");
	const diffFile = join(dir, "change.patch");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		writeFileSync(
			diffFile,
			[
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,1 +1,2 @@",
				"+ const x = 1;",
				`+ const name = "${TERM}";`,
			].join("\n"),
		);
		const run = spawnSync(
			process.execPath,
			[SCANNER, "--terms-file", termsFile, "--diff", diffFile],
			{ encoding: "utf8" },
		);
		assert.equal(run.status, EXIT_FOUND);
		assert.equal(run.stdout.includes(TERM), false);
		assert.equal(run.stderr.includes(TERM), false);
		assert.match(run.stdout, /src\/app\.ts/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the command line passes a clean diff", () => {
	const dir = mkdtempSync(join(tmpdir(), "scan-"));
	const termsFile = join(dir, "terms.txt");
	const diffFile = join(dir, "change.patch");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		writeFileSync(
			diffFile,
			["diff --git a/src/app.ts b/src/app.ts", "@@ -1,1 +1,2 @@", "+ const x = 1;"].join("\n"),
		);
		const run = spawnSync(
			process.execPath,
			[SCANNER, "--terms-file", termsFile, "--diff", diffFile],
			{ encoding: "utf8" },
		);
		assert.equal(run.status, EXIT_CLEAN);
		assert.match(run.stdout, /no sensitive term was found/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the command line refuses to pass when there is no list", () => {
	const dir = mkdtempSync(join(tmpdir(), "scan-"));
	const termsFile = join(dir, "terms.txt");
	const diffFile = join(dir, "change.patch");
	try {
		writeFileSync(termsFile, "\n# only a comment\n");
		writeFileSync(diffFile, "diff --git a/a b/a\n@@ -1,1 +1,1 @@\n+ x");
		const run = spawnSync(
			process.execPath,
			[SCANNER, "--terms-file", termsFile, "--diff", diffFile],
			{ encoding: "utf8" },
		);
		// Not 0: a check that could not run must not look like a pass.
		assert.equal(run.status, EXIT_UNAVAILABLE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a pull request is scanned through its files, its title and its body", async () => {
	const calls = [];
	const fakeFetch = async (url) => {
		calls.push(url);
		if (url.includes("/files?")) {
			return {
				ok: true,
				json: async () => [
					{
						filename: "src/app.ts",
						patch: `@@ -1,1 +1,2 @@\n+ const x = 1;\n+ const n = "${TERM}";`,
					},
				],
			};
		}
		return {
			ok: true,
			json: async () => ({ title: "a title", body: `a body with ${TERM}` }),
		};
	};

	const result = await scanPullRequest({
		owner: "example",
		repo: "example",
		number: 7,
		token: "t",
		terms: TERMS,
		fetchImpl: fakeFetch,
	});

	const paths = result.hits.map((hit) => hit.path);
	assert.ok(paths.includes("src/app.ts"), "the added line is a hit");
	assert.ok(paths.includes("pull request body"), "the body is a hit");
	assert.equal(calls.length, 2);
});

test("a pull request that cannot be read is not a clean pull request", async () => {
	const fakeFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
	await assert.rejects(
		() =>
			scanPullRequest({
				owner: "example",
				repo: "example",
				number: 7,
				token: "t",
				terms: TERMS,
				fetchImpl: fakeFetch,
			}),
		/HTTP 503/,
	);
});

test("the repository of a checkout comes from its origin remote", () => {
	// A local run has no GITHUB_REPOSITORY, and the origin remote
	// names the same thing.
	const repo = repositoryFromRemote(ROOT);
	assert.match(repo ?? "", /^[^/]+\/[^/]+$/);
});

test("a directory without a remote has no repository", () => {
	const dir = mkdtempSync(join(tmpdir(), "no-remote-"));
	try {
		assert.equal(repositoryFromRemote(dir), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the source of the check is text, so the tools can read it", () => {
	// A raw NUL byte in a source file makes it a binary file for grep,
	// for diff and for every editor. The check for a binary payload
	// used to carry one, written as the byte itself instead of the
	// escape sequence.
	const source = readFileSync(
		join(ROOT, "scripts", "check-sensitive-terms.mjs"),
	);
	assert.equal(source.includes(0), false, "the source holds no NUL byte");
});

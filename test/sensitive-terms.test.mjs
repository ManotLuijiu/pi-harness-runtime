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
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
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
	listTreeFiles,
	scanTree,
	commitMessages,
	scanCommitMessages,
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
		if (url.includes("/commits?")) {
			// The commit messages of the pull request. They are public
			// as well, and GitHub builds the release notes from them.
			return {
				ok: true,
				json: async () => [
					{ sha: "a".repeat(40), commit: { message: `a commit with ${TERM}` } },
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
	assert.ok(paths.includes("a".repeat(40)), "the commit message is a hit");
	// The pull request, its files and its commits.
	assert.equal(calls.length, 3);
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

// The scan of a directory tree.
//
// A published package is a directory tree. The check that keeps a client
// name out of a pull request protects the pull request; this one protects
// the package that npm serves to everybody.

test("a term in a file of the tree is found", () => {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-tree-"));
	try {
		writeFileSync(join(dir, "plain.txt"), "nothing to see\n", "utf8");
		writeFileSync(join(dir, "held.txt"), "the placeholder lives here\n", "utf8");
		const result = scanTree(dir, ["placeholder"]);
		assert.equal(result.scanned, 2);
		assert.equal(result.hits.length, 1);
		assert.equal(result.hits[0].path, "held.txt");
		assert.equal(result.hits[0].line, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a term in the name of a file of the tree is found", () => {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-tree-"));
	try {
		mkdirSync(join(dir, "sub"), { recursive: true });
		writeFileSync(join(dir, "sub", "placeholder.txt"), "nothing to see\n", "utf8");
		const result = scanTree(dir, ["placeholder"]);
		assert.equal(result.hits.length, 1);
		// The path is the place the term is in, so it is reported on
		// line 0.
		assert.equal(result.hits[0].path, "sub/placeholder.txt");
		assert.equal(result.hits[0].line, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a clean tree holds no hit", () => {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-tree-"));
	try {
		writeFileSync(join(dir, "plain.txt"), "nothing to see\n", "utf8");
		const result = scanTree(dir, ["placeholder"]);
		assert.equal(result.hits.length, 0);
		assert.equal(result.scanned, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a symlink is not a file of the tree", () => {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-tree-"));
	try {
		const outside = mkdtempSync(join(tmpdir(), "sensitive-outside-"));
		try {
			writeFileSync(join(outside, "secret.txt"), "the placeholder lives here\n", "utf8");
			symlinkSync(outside, join(dir, "link"), "dir");
			const files = listTreeFiles(dir);
			assert.equal(files.length, 0, "the link is not followed");
			assert.equal(scanTree(dir, ["placeholder"]).hits.length, 0);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the report of a tree scan hides the term in the path", () => {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-tree-"));
	try {
		writeFileSync(join(dir, "placeholder.txt"), "nothing to see\n", "utf8");
		const result = scanTree(dir, ["placeholder"]);
		const report = formatReport({ ...result, terms: ["placeholder"] });
		assert.equal(report.includes("placeholder"), false, "the term is not printed");
		assert.match(report, /\*\*\*/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a tree that does not exist is not a clean run", () => {
	// The check fails closed: a directory that is not there is a
	// broken setup, not "nothing was found".
	const result = spawnSync(
		process.execPath,
		[join(ROOT, "scripts", "check-sensitive-terms.mjs"), "--tree", join(tmpdir(), "no-such-tree-")],
		{
			cwd: ROOT,
			encoding: "utf8",
			timeout: 60000,
			env: { ...process.env, SENSITIVE_TERMS: "placeholder" },
		},
	);
	assert.equal(result.status, 2, "the exit code says the check could not run");
});

test("a tree with a term fails the command", () => {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-tree-"));
	try {
		writeFileSync(join(dir, "held.txt"), "the placeholder lives here\n", "utf8");
		const result = spawnSync(
			process.execPath,
			[join(ROOT, "scripts", "check-sensitive-terms.mjs"), "--tree", dir],
			{
				cwd: ROOT,
				encoding: "utf8",
				timeout: 60000,
				env: { ...process.env, SENSITIVE_TERMS: "placeholder" },
			},
		);
		assert.equal(result.status, 1, "the exit code says a term was found");
		assert.equal(result.stdout.includes("placeholder"), false, "the term is not printed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// The commit messages of a range.
//
// A commit message is public the moment the commit is pushed, and it
// travels further than the change does: GitHub builds the release notes
// from the commit messages, and the release notes are public too.

/** A repository with one commit that carries a message. */
function repoWithMessage(message) {
	const dir = mkdtempSync(join(tmpdir(), "sensitive-git-"));
	const env = {
		...process.env,
		GIT_AUTHOR_NAME: "harness test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "harness test",
		GIT_COMMITTER_EMAIL: "test@example.com",
	};
	const git = (args) =>
		spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: 60000, env });
	git(["init", "--quiet"]);
	writeFileSync(join(dir, "a.txt"), "content\n", "utf8");
	git(["add", "a.txt"]);
	const committed = git(["commit", "--quiet", "-m", message]);
	assert.equal(committed.status, 0, committed.stderr);
	return dir;
}

test("a term in a commit message is found", () => {
	const dir = repoWithMessage("fix: the placeholder in the title\n");
	try {
		const result = scanCommitMessages("HEAD", ["placeholder"], dir);
		assert.equal(result.hits.length, 1);
		assert.equal(result.hits[0].line, 1);
		// The place is the commit, not a file.
		assert.match(result.hits[0].path, /^[0-9a-f]{40}$/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a clean commit message is no hit", () => {
	const dir = repoWithMessage("fix: something ordinary\n");
	try {
		const result = scanCommitMessages("HEAD", ["placeholder"], dir);
		assert.equal(result.hits.length, 0);
		assert.equal(result.scanned, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the commit messages of a range are read with their commit", () => {
	const dir = repoWithMessage("fix: the placeholder in the body\n\nand more of it\n");
	try {
		const commits = commitMessages("HEAD", dir);
		assert.equal(commits.length, 1);
		assert.match(commits[0].sha, /^[0-9a-f]{40}$/);
		assert.match(commits[0].message, /the placeholder in the body/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the report of a commit message scan never prints the term", () => {
	const dir = repoWithMessage("fix: the placeholder in the title\n");
	try {
		const result = scanCommitMessages("HEAD", ["placeholder"], dir);
		const report = formatReport({ ...result, terms: ["placeholder"] });
		assert.equal(report.includes("placeholder"), false, "the term is not printed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a mode without its value is not a clean run, it is a broken command", () => {
	const dir = mkdtempSync(join(tmpdir(), "scan-"));
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		for (const args of [
			["--diff"],
			["--file"],
			["--range"],
			["--tree"],
			["--commits"],
		]) {
			const run = spawnSync(
				process.execPath,
				[SCANNER, "--terms-file", termsFile, ...args],
				{ encoding: "utf8" },
			);
			// Not 0: a check that could not run must not look like a pass.
			assert.equal(
				run.status,
				EXIT_UNAVAILABLE,
				`the mode ${args[0]} without a value must not pass`,
			);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a commit range that holds no commit is not a clean run", () => {
	const dir = mkdtempSync(join(tmpdir(), "scan-"));
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		// A range that cannot exist. Scanning it would report a clean
		// result for a check that never read a commit.
		const run = spawnSync(
			process.execPath,
			[SCANNER, "--terms-file", termsFile, "--commits", "no-such-tag..no-such-tag"],
			{ encoding: "utf8" },
		);
		assert.equal(run.status, EXIT_UNAVAILABLE);
		assert.match(run.stderr, /no commit/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a range that holds no change is not a clean run", () => {
	// The push path of the workflow scans the range of a push. A range
	// that holds nothing was written wrong, and reporting a clean
	// result for it would be a check that never ran.
	const dir = repoWithMessage("fix: something ordinary\n");
	try {
		const termsFile = join(dir, "terms.txt");
		writeFileSync(termsFile, `${TERM}\n`);
		const run = spawnSync(
			process.execPath,
			[SCANNER, "--terms-file", termsFile, "--range", "HEAD..HEAD"],
			{ encoding: "utf8", cwd: dir },
		);
		assert.equal(run.status, EXIT_UNAVAILABLE);
		assert.match(run.stderr, /holds nothing/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

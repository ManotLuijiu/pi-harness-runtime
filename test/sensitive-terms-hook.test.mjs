/**
 * The pre-push hook is the part of the guard that runs before the bytes
 * leave the machine. The workflow can stop a pull request from being
 * merged; it cannot undo a push that already carried a name.
 *
 * This hook once looked right and did nothing at all. Its test for "is
 * this a commit" was a shell pattern with a character class written as
 * `[^...]`, and a POSIX shell reads that caret as a literal member of
 * the set rather than as a negation. Every commit matched, every commit
 * was skipped, and the hook let every push through. In bash the same
 * pattern negates, so the mistake only showed up in the shell that
 * `/bin/sh` points at.
 *
 * A guard that silently does nothing is worse than no guard, so the
 * behavior is tested here and not the shape of the script.
 *
 * The term is a placeholder. A real client name in a test of the check
 * that keeps client names out would be the exact mistake the check
 * exists to prevent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const HOOK = join(ROOT, ".githooks", "pre-push");

/** A term that is not a real name. */
const TERM = "zzplaceholdername";

/** Run a command in the repository. */
function run(command, args, extra = {}) {
	return spawnSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 120000,
		...extra,
	});
}

/**
 * A commit that holds a file, built without touching the worktree.
 *
 * The commit is made from a tree that is written into a temporary
 * index, so the branch and the files of the repository are untouched.
 */
function commitWith(file, content, message = "a test commit") {
	// The index is a file inside a directory of its own - git writes
	// the index as a file, and a directory of that name is not one.
	const dir = mkdtempSync(join(tmpdir(), "hook-index-"));
	const index = join(dir, "index");
	// The identity is set for the commit. A checkout on a build
	// machine has no git identity configured, and `git commit-tree`
	// refuses to write a commit without one - which failed here and
	// passed at home.
	const env = {
		...process.env,
		GIT_INDEX_FILE: index,
		GIT_AUTHOR_NAME: "harness test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "harness test",
		GIT_COMMITTER_EMAIL: "test@example.com",
	};
	try {
		assert.equal(run("git", ["read-tree", "HEAD"], { env }).status, 0);
		const hashed = run("git", ["hash-object", "-w", "--stdin"], {
			env,
			input: content,
		});
		assert.equal(hashed.status, 0, hashed.stderr);
		const blob = hashed.stdout.trim();
		assert.notEqual(blob, "");
		const updated = run(
			"git",
			["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`],
			{ env },
		);
		assert.equal(updated.status, 0, updated.stderr);
		const tree = run("git", ["write-tree"], { env }).stdout.trim();
		const committed = run("git", ["commit-tree", tree, "-p", "HEAD", "-m", message], {
			env,
		});
		assert.equal(committed.status, 0, committed.stderr);
		const commit = committed.stdout.trim();
		assert.notEqual(commit, "");
		return commit;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The push that git hands to a pre-push hook. */
function pushOf(commit, base) {
	return `refs/heads/test ${commit} refs/heads/test ${base}\n`;
}

test("the hook is there and it is executable", () => {
	assert.ok(existsSync(HOOK), "the hook file is missing");
	// Git only runs a hook that is executable.
	assert.ok(statSync(HOOK).mode & 0o111, "the hook is not executable");
});

test("the hook stops a push that holds a term", () => {
	const dir = mkdtempSync(join(tmpdir(), "hook-terms-"));
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
		const commit = commitWith("leak.txt", `const client = "${TERM}";\n`);
		const result = run("sh", [HOOK], {
			input: pushOf(commit, base),
			env: { ...process.env, PI_SENSITIVE_TERMS_FILE: termsFile },
		});
		assert.equal(result.status, 1, "the push was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		// The report names the place, never the term.
		assert.equal(output.includes(TERM), false, "the term was printed");
		assert.match(output, /leak\.txt/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the hook stops a push that holds a term in a file name", () => {
	const dir = mkdtempSync(join(tmpdir(), "hook-terms-"));
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
		const commit = commitWith(`docs/${TERM}.md`, "clean content\n");
		const result = run("sh", [HOOK], {
			input: pushOf(commit, base),
			env: { ...process.env, PI_SENSITIVE_TERMS_FILE: termsFile },
		});
		assert.equal(result.status, 1, "the push was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		// The path is where the term is, so the path is printed with
		// the term hidden.
		assert.equal(output.includes(TERM), false, "the term was printed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the hook lets a clean push through", () => {
	const dir = mkdtempSync(join(tmpdir(), "hook-terms-"));
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
		const commit = commitWith("clean.txt", "nothing to see here\n");
		const result = run("sh", [HOOK], {
			input: pushOf(commit, base),
			env: { ...process.env, PI_SENSITIVE_TERMS_FILE: termsFile },
		});
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("without a list the hook does not pretend to have checked", () => {
	const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
	const commit = commitWith("clean.txt", "nothing to see here\n");
	const result = run("sh", [HOOK], {
		input: pushOf(commit, base),
		env: { ...process.env, PI_SENSITIVE_TERMS_FILE: "/nonexistent/terms.txt" },
	});
	// A machine that does not know the names cannot check for them.
	assert.equal(result.status, 0);
	assert.match(`${result.stdout}${result.stderr}`, /the push was not checked/);
});

test("the hook stops a push whose commit message holds a term", () => {
	// A commit message is public the moment the commit is pushed, and it
	// travels further than the change does: GitHub builds the release
	// notes from the commit messages. A name in a message is therefore a
	// name in the release notes of every later release.
	const dir = mkdtempSync(join(tmpdir(), "hook-terms-"));
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
		const commit = commitWith("clean.txt", "nothing to see here\n", `fix: ${TERM} in the title`);
		const result = run("sh", [HOOK], {
			input: pushOf(commit, base),
			env: { ...process.env, PI_SENSITIVE_TERMS_FILE: termsFile },
		});
		assert.equal(result.status, 1, "the push was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		assert.equal(output.includes(TERM), false, "the term was printed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

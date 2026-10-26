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
import {
	mkdtempSync,
	writeFileSync,
	rmSync,
	existsSync,
	statSync,
	mkdirSync,
	copyFileSync,
	chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const HOOK = join(ROOT, ".husky", "pre-push");
const PRE_COMMIT_HOOK = join(ROOT, ".husky", "pre-commit");

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

test("the hooks are there and they are executable", () => {
	for (const hook of [HOOK, PRE_COMMIT_HOOK]) {
		assert.ok(existsSync(hook), `the hook file is missing: ${hook}`);
		// Git only runs a hook that is executable.
		assert.ok(statSync(hook).mode & 0o111, "the hook is not executable");
	}
});

test("the repository uses the husky hooks path", () => {
	// Husky owns the hooks of the repository. A second mechanism would
	// be a second place where a guard can be forgotten.
	const hooksPath = run("git", ["config", "--get", "core.hooksPath"]).stdout.trim();
	assert.equal(hooksPath, ".husky/_");
	assert.equal(existsSync(join(ROOT, ".githooks")), false, "the old hook directory is still there");
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

test("a new tag on a commit that is already pushed is let through", () => {
	// A tag is not a commit: the object a tag points at is the tag
	// itself. The hook has to look at the commit behind it, and a tag
	// that adds no commit has nothing to check - the check of that
	// commit already ran on the push that brought it here.
	const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
	// The identity is set for the tag. A checkout on a build machine
	// has no git identity configured, and an annotated tag refuses to be
	// written without one.
	const env = {
		...process.env,
		GIT_AUTHOR_NAME: "harness test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "harness test",
		GIT_COMMITTER_EMAIL: "test@example.com",
	};
	// The hook reads a list of its own. The list of the machine that
	// runs the test is not used: a build machine has no list, and the
	// test has to say the same thing everywhere.
	const dir = mkdtempSync(join(tmpdir(), "hook-terms-"));
	const termsFile = join(dir, "terms.txt");
	writeFileSync(termsFile, `${TERM}\n`);
	env.PI_SENSITIVE_TERMS_FILE = termsFile;
	const created = run("git", ["tag", "-a", "hook-test-tag", "-m", "a tag", head], {
		env,
	});
	assert.equal(created.status, 0, created.stderr);
	try {
		const tagSha = run("git", ["rev-parse", "refs/tags/hook-test-tag"]).stdout.trim();
		const input =
			`refs/tags/hook-test-tag ${tagSha} refs/tags/hook-test-tag ` +
			"0000000000000000000000000000000000000000\n";
		const result = run(HOOK, [], { input, env });
		assert.equal(result.status, 0, result.stderr + result.stdout);
	} finally {
		run("git", ["tag", "-d", "hook-test-tag"], { env });
		rmSync(dir, { recursive: true, force: true });
	}
});

test("without a list the push is stopped and the way out is named", () => {
	const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
	const commit = commitWith("clean.txt", "nothing to see here\n");
	const result = run("sh", [HOOK], {
		input: pushOf(commit, base),
		env: { ...process.env, PI_SENSITIVE_TERMS_FILE: "/nonexistent/terms.txt" },
	});
	// The owner pushes straight to the working branch, so the local
	// hook is the gate that runs before the bytes leave the machine.
	// A machine that cannot check does not let the push through.
	assert.equal(result.status, 1);
	const output = `${result.stdout}${result.stderr}`;
	assert.match(output, /the term list is missing/);
	// The way out is named, so the fix is one command away.
	assert.match(output, /PI_SENSITIVE_TERMS_FILE/);
});

test("the documented skip lets a push through without the list", () => {
	const base = run("git", ["rev-parse", "HEAD"]).stdout.trim();
	const commit = commitWith("clean.txt", "nothing to see here\n");
	const result = run("sh", [HOOK], {
		input: pushOf(commit, base),
		env: {
			...process.env,
			PI_SENSITIVE_TERMS_FILE: "/nonexistent/terms.txt",
			PI_SENSITIVE_TERMS_SKIP: "1",
		},
	});
	// A contributor without the private list works this way, and the
	// check of the repository does the work for them.
	assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	assert.match(`${result.stdout}${result.stderr}`, /the local scan was skipped/);
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

/**
 * A scratch repository with the hook and the scanner in it.
 *
 * The hook reads the staged change of the repository it runs in, so
 * the test needs a repository of its own: staging a file in the
 * repository of the owner would touch the work of whoever runs the
 * test.
 */
function scratchRepo() {
	const dir = mkdtempSync(join(tmpdir(), "hook-repo-"));
	run("git", ["init", "-q", dir]);
	run("git", ["-C", dir, "config", "user.email", "test@example.com"]);
	run("git", ["-C", dir, "config", "user.name", "harness test"]);
	mkdirSync(join(dir, "scripts"), { recursive: true });
	copyFileSync(
		join(ROOT, "scripts", "check-sensitive-terms.mjs"),
		join(dir, "scripts", "check-sensitive-terms.mjs"),
	);
	mkdirSync(join(dir, ".husky"), { recursive: true });
	copyFileSync(PRE_COMMIT_HOOK, join(dir, ".husky", "pre-commit"));
	chmodSync(join(dir, ".husky", "pre-commit"), 0o755);
	writeFileSync(join(dir, "README.md"), "# scratch\n");
	run("git", ["-C", dir, "add", "README.md"]);
	run("git", ["-C", dir, "commit", "-q", "-m", "first"]);
	return dir;
}

/** The pre-commit hook of a scratch repository, with a staged file. */
function stageAndRun(dir, file, content, env = {}) {
	// The file can live in a directory that does not exist yet.
	mkdirSync(dirname(join(dir, file)), { recursive: true });
	writeFileSync(join(dir, file), content);
	const added = run("git", ["-C", dir, "add", "--", file]);
	assert.equal(added.status, 0, added.stderr);
	return run("sh", [join(dir, ".husky", "pre-commit")], {
		cwd: dir,
		env: { ...process.env, ...env },
	});
}

test("the pre-commit hook stops a commit whose staged file holds a term", () => {
	const dir = scratchRepo();
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const result = stageAndRun(dir, "leak.txt", `const client = "${TERM}";\n`, {
			PI_SENSITIVE_TERMS_FILE: termsFile,
		});
		assert.equal(result.status, 1, "the commit was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		assert.equal(output.includes(TERM), false, "the term was printed");
		// The place is named, so the author knows where to look.
		assert.match(output, /leak\.txt/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the pre-commit hook scans every kind of staged file", () => {
	const dir = scratchRepo();
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		// A name in a document is a name in a public repository just
		// as much as a name in a source file.
		const result = stageAndRun(dir, "docs/plan.md", `# ${TERM}\n`, {
			PI_SENSITIVE_TERMS_FILE: termsFile,
		});
		assert.equal(result.status, 1, "the commit was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		assert.equal(output.includes(TERM), false, "the term was printed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the pre-commit hook stops a commit whose staged path holds a term", () => {
	const dir = scratchRepo();
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const result = stageAndRun(dir, `docs/${TERM}.md`, "clean content\n", {
			PI_SENSITIVE_TERMS_FILE: termsFile,
		});
		assert.equal(result.status, 1, "the commit was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		assert.equal(output.includes(TERM), false, "the term was printed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the pre-commit hook lets a clean commit through", () => {
	const dir = scratchRepo();
	const termsFile = join(dir, "terms.txt");
	try {
		writeFileSync(termsFile, `${TERM}\n`);
		const result = stageAndRun(dir, "clean.txt", "nothing to see here\n", {
			PI_SENSITIVE_TERMS_FILE: termsFile,
		});
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the pre-commit hook stops a commit when the list is missing", () => {
	const dir = scratchRepo();
	try {
		const result = stageAndRun(dir, "clean.txt", "nothing to see here\n", {
			PI_SENSITIVE_TERMS_FILE: join(dir, "no-such-list.txt"),
		});
		assert.equal(result.status, 1, "the commit was not stopped");
		const output = `${result.stdout}${result.stderr}`;
		assert.match(output, /the term list is missing/);
		assert.match(output, /PI_SENSITIVE_TERMS_FILE/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the documented skip lets a commit through without the list", () => {
	const dir = scratchRepo();
	try {
		const result = stageAndRun(dir, "clean.txt", "nothing to see here\n", {
			PI_SENSITIVE_TERMS_FILE: join(dir, "no-such-list.txt"),
			PI_SENSITIVE_TERMS_SKIP: "1",
		});
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

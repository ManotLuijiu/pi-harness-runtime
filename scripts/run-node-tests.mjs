#!/usr/bin/env node
/**
 * Run the test files that can run under node.
 *
 * The root suite (`npm test`) runs every test file under bun, one file per
 * process. That is the authoritative suite: the harness sources are
 * TypeScript and import each other with the ".js" specifier convention, and
 * bun maps such a specifier to the TypeScript source. Node resolves the
 * specifier to a real file, so it needs the compiled artifacts.
 *
 * This suite is the other half of the promise: it proves that the code a
 * consumer receives still runs under node, the runtime that pi itself uses.
 * Only a part of the root suite can do that, because some files cannot be
 * loaded by node at all:
 *
 *   - one imports `bun:test`, which node's ESM loader rejects outright,
 *   - one reads a source that uses a TypeScript parameter property, which
 *     node's strip-only mode cannot transform,
 *   - the rest reach a root-level or harness module whose internal
 *     specifiers use the compiled ".js" convention. Bun maps such a
 *     specifier to the TypeScript source; node resolves it to a real file.
 *     The published package ships the root sources as TypeScript, so those
 *     files are meant to run under bun.
 *
 * The npm script used to run `node --test` over every test file, which
 * failed on exactly those files. A script that always fails is worse than
 * no script: it looks like a failing test and hides the files that really
 * do run under node.
 *
 * The excluded files are listed by name and reason on every run, so nobody
 * can mistake "not run here" for "passed here". The root suite still runs
 * all of them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Files that node cannot load, and why. Each entry names a real reason; a
 * file that starts working under node has to be taken out of this list, not
 * left in it.
 */
const NOT_NODE_COMPATIBLE = new Map([
	[
		"test/console-guard.test.mjs",
		"imports bun:test, which node's ESM loader rejects",
	],
	[
		"test/skill-remote-source.test.mjs",
		"the source uses a TypeScript parameter property, which node's strip-only mode cannot transform",
	],
	[
		"test/loop-runtime.test.mjs",
		"reaches a harness module that imports siblings with the compiled '.js' convention, and the repository does not compile the harness",
	],
	[
		"test/quota-status.test.mjs",
		"reaches a harness module that imports siblings with the compiled '.js' convention, and the repository does not compile the harness",
	],
	[
		"test/mirror.test.mjs",
		"reaches a root-level module that imports siblings with the compiled '.js' convention, and the published package ships the root sources as TypeScript",
	],
	[
		"test/renderer.test.mjs",
		"reaches a root-level module that imports siblings with the compiled '.js' convention, and the published package ships the root sources as TypeScript",
	],
	[
		"test/repair-engine.test.mjs",
		"reaches a root-level module that imports siblings with the compiled '.js' convention, and the published package ships the root sources as TypeScript",
	],
	[
		"test/tracker.test.mjs",
		"reaches a root-level module that imports siblings with the compiled '.js' convention, and the published package ships the root sources as TypeScript",
	],
]);

/** The directories that hold test files. */
const SUITE_DIRS = ["test", join("packages", "clipboard", "test")];

/** Directories below a suite root that hold helpers, not suites. */
const NON_SUITE_DIRS = new Set(["helpers", "fixtures"]);

/**
 * The per-test timeout. A few of these files pack the whole application or
 * start a shell script, and node's default of five seconds is enough on a
 * fast machine and not enough on a slow one.
 */
const TEST_TIMEOUT_MS = 120_000;

const root = join(import.meta.dirname, "..");

/** The same path with POSIX separators, so the list compares across systems. */
function toPosixPath(file) {
	return file.split(sep).join("/");
}

/** Every test file below a suite root. */
function findTestFiles(dir) {
	const abs = join(root, dir);
	if (!existsSync(abs)) return [];
	const found = [];
	for (const name of readdirSync(abs, { recursive: true })) {
		if (!name.endsWith(".test.mjs")) continue;
		const relativePath = toPosixPath(join(dir, name));
		if (relativePath.split("/").some((segment) => NON_SUITE_DIRS.has(segment))) continue;
		found.push(relativePath);
	}
	return found.sort();
}

const allFiles = SUITE_DIRS.flatMap(findTestFiles).sort();

if (allFiles.length === 0) {
	// The published package ships the scripts but not the test files, so an
	// installed copy has nothing to run. A missing suite in the repository is
	// a regression, though - never let it pass silently.
	const isInstalledCopy =
		process.env.PI_HARNESS_INSTALLED === "1" || root.split(sep).includes("node_modules");
	if (isInstalledCopy) {
		console.log("node tests: no test files in this installation - nothing to run");
		process.exit(0);
	}
	console.error("node tests: the test suite is missing - no *.test.mjs files found");
	process.exit(1);
}

const excluded = [];
const selected = [];
for (const file of allFiles) {
	const reason = NOT_NODE_COMPATIBLE.get(file);
	if (reason) {
		excluded.push({ file, reason });
	} else {
		selected.push(file);
	}
}

// An exclusion that names a file that does not exist is a stale list, and a
// stale list hides a file that could run.
for (const { file } of excluded) {
	if (!allFiles.includes(file)) {
		console.error(`node tests: the exclusion list names "${file}", which does not exist`);
		process.exit(1);
	}
}

/**
 * An excluded file has to be excluded for a reason that still holds: the
 * suite runs a file with `node --test`, so a file that passes under node
 * belongs in the suite. If it passes, the exclusion is stale and it is
 * quietly keeping a file out of the suite that would have run.
 */
for (const { file, reason } of excluded) {
	const probe = spawnSync(
		process.execPath,
		["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, file],
		{ cwd: root, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 },
	);
	if (probe.status === 0) {
		console.error(
			`node tests: "${file}" is excluded but passes under node in this tree - either the exclusion is stale, or this tree has compiled artifacts that a clean checkout does not have`,
		);
		process.exit(1);
	}
	console.log(`node tests: confirmed ${file} does not run under node (${reason})`);
}

console.log(`node tests: ${selected.length} file(s) selected, ${excluded.length} skipped`);
for (const { file, reason } of excluded) {
	console.log(`node tests: skipped ${file} - ${reason}`);
}
if (selected.length === 0) {
	console.error("node tests: no file can run under node");
	process.exit(1);
}

const result = spawnSync(
	process.execPath,
	["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, ...selected],
	{ cwd: root, encoding: "utf8", timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 },
);

// node writes the report to stdout; the exit code carries the verdict.
process.stdout.write(result.stdout ?? "");
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
	console.error(`node tests: ${result.error.message}`);
	process.exit(1);
}
if (result.status !== 0) {
	console.error(`node tests: FAILED (exit ${result.status})`);
	process.exit(result.status ?? 1);
}
console.log(`node tests: ${selected.length} file(s) passed under node`);

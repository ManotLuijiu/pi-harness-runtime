#!/usr/bin/env node
/**
 * Run the root test suite one file per process, with bun as the runtime.
 *
 * Why bun and not `node --test`:
 *
 * The harness sources are TypeScript and import each other with the
 * ".js" specifier convention (`import { x } from "./loop-runtime.js"`).
 * Node resolves that specifier to a real file, so it needs the compiled
 * artifacts - and those artifacts are gitignored build output
 * (`.gitignore` ignores `harness/*.js` and the compiled JavaScript in
 * `packages/<name>/src`). A clean checkout therefore cannot run the suite
 * under node: every import of a sibling module fails with
 * ERR_MODULE_NOT_FOUND.
 *
 * Bun maps a ".js" specifier to the TypeScript source when no JavaScript
 * file exists, which is exactly how the harness runs in production (pi
 * loads the extension with bun). Running the suite with bun therefore
 * tests the same module graph that ships.
 *
 * One file per process, because:
 *
 * 1. A file that calls `process.exit(0)` (the network diagnostics) would
 *    abort a whole directory run.
 * 2. Bun's exit code is only reliable per file: a directory run can end
 *    with 0 even when a file failed to load.
 *
 * A file that executes no test at all is a FAILURE, unless it is one of
 * the known diagnostics that deliberately exit before registering a test.
 * A green banner must mean that the assertions really ran.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const PER_FILE_TIMEOUT_MS = 120_000;

/** The directories that hold the root test files. */
const SUITE_DIRS = ["test", join("packages", "clipboard", "test")];

/** Directories below a suite root that hold helpers, not suites. */
const NON_SUITE_DIRS = new Set(["helpers", "fixtures"]);

/**
 * The only files that may exit without executing a test: they print a
 * SKIP banner and leave the process before they register a test. Every
 * other file that runs no test is a failure - that is what keeps a broken
 * runner from reporting a green suite.
 */
const EXPECTED_NO_TESTS = new Set([
	"test/chatgpt-api.test.mjs",
	"test/chatgpt-cookies.test.mjs",
	"test/zai-cookies.test.mjs",
]);

/** The same path with POSIX separators, so the allowlist works on Windows too. */
function toPosixPath(file) {
	return file.split(sep).join("/");
}

// bun is installed globally (not into node_modules/.bin), so use PATH.
const bun = process.env.BUN_BIN ?? "bun";
let bunVersion = "unknown";
try {
	bunVersion = execFileSync(bun, ["--version"], {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
	}).trim();
} catch {
	console.error(`root tests: "${bun}" is not executable - install bun or set BUN_BIN`);
	process.exit(1);
}
console.log(`root tests: runtime ${bun} ${bunVersion}`);

const root = join(import.meta.dirname, "..");

/** Every *.test.mjs below a suite root (recursively). */
function findTestFiles(dir) {
	const abs = join(root, dir);
	if (!existsSync(abs)) return [];
	const found = [];
	const excluded = [];
	for (const name of readdirSync(abs, { recursive: true })) {
		if (!name.endsWith(".test.mjs")) continue;
		const relativePath = join(dir, name);
		const segments = relativePath.split(sep);
		if (segments.some((segment) => NON_SUITE_DIRS.has(segment))) {
			excluded.push(relativePath);
			continue;
		}
		found.push(relativePath);
	}
	if (excluded.length > 0) {
		console.log(`root tests: ${excluded.length} helper file(s) excluded: ${excluded.join(", ")}`);
	}
	return found.sort();
}

const files = SUITE_DIRS.flatMap(findTestFiles);

if (files.length === 0) {
	// The published package ships the scripts but not the test files, so an
	// installed copy has nothing to run. A missing suite in the repository
	// is a regression, though - never let it pass silently.
	const isInstalledCopy =
		process.env.PI_HARNESS_INSTALLED === "1" || root.split(sep).includes("node_modules");
	if (isInstalledCopy) {
		console.log("root tests: no test files in this installation - nothing to run");
		process.exit(0);
	}
	console.error("root tests: the root test suite is missing - no *.test.mjs files found");
	process.exit(1);
}

console.log(`root tests: ${files.length} files discovered`);

const failed = [];
const skipped = [];
let passedFiles = 0;
let passedTests = 0;

for (const file of files) {
	const started = Date.now();
	// bun writes the test report to stderr, stdout only carries the banner,
	// so both streams are needed for the summary. The path is relative to
	// the repository root: bun treats an argument as a filter, and a
	// relative path avoids the glob-like characters of an absolute one.
	const result = spawnSync(bun, ["test", `./${file}`], {
		cwd: root,
		encoding: "utf8",
		timeout: PER_FILE_TIMEOUT_MS,
		maxBuffer: 32 * 1024 * 1024,
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	const code = result.status ?? -1;
	const killed = Boolean(result.signal) || result.error?.code === "ETIMEDOUT";
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const summary = output
		.split("\n")
		.filter((line) => /pass|fail|skip|Ran /.test(line))
		.slice(-4)
		.join(" | ");

	// Did the file really execute a test? The "N pass" line is the primary
	// source: it counts exactly the tests that ran. The "Ran N tests" line
	// includes the skipped ones on bun 1.3.14, so it is only a fallback.
	const ran = output.match(/^Ran\s+(\d+)\s+tests?\b/m);
	const passed = output.match(/^\s*(\d+)\s+pass\s*$/m);
	const skippedTests = output.match(/^\s*(\d+)\s+skip\s*$/m);
	const total = ran ? Number(ran[1]) : passed ? Number(passed[1]) : 0;
	const skippedCount = skippedTests ? Number(skippedTests[1]) : 0;
	// The "N pass" line counts exactly the tests that ran. The "Ran N tests"
	// line includes the skipped ones on bun 1.3.14, so it is only a fallback.
	const executed = passed ? Number(passed[1]) : Math.max(0, total - skippedCount);
	const allSkipped = total > 0 && skippedTests !== null && skippedCount === total;

	// A killed child is a failure, even when the exit code says 0.
	if (killed) {
		failed.push(file);
		console.error(`FAIL ${file} (${seconds}s, killed, exit ${code}) ${summary.slice(0, 200)}`);
		console.error(output.split("\n").slice(-40).join("\n").trim());
		continue;
	}

	if (code === 0 && executed === 0) {
		if (EXPECTED_NO_TESTS.has(toPosixPath(file))) {
			skipped.push(file);
			console.log(`skip ${file} (${seconds}s) no tests executed (known diagnostic)`);
		} else if (allSkipped) {
			// Every test in the file was explicitly skipped (an opt-in suite).
			// That is a skip, not a pass and not a failure.
			skipped.push(file);
			console.log(`skip ${file} (${seconds}s) all ${total} test(s) skipped`);
		} else {
			failed.push(file);
			console.error(`FAIL ${file} (${seconds}s) executed no test at all`);
			console.error(output.split("\n").slice(-20).join("\n").trim());
		}
		continue;
	}

	if (code === 0) {
		passedFiles++;
		passedTests += executed;
		console.log(`ok   ${file} (${seconds}s) ${summary.slice(0, 110)}`);
		continue;
	}

	failed.push(file);
	console.error(`FAIL ${file} (${seconds}s, exit ${code}) ${summary.slice(0, 200)}`);
	console.error(output.split("\n").slice(-40).join("\n").trim());
}

console.log(
	`root tests: ${passedFiles}/${files.length} files passed (${passedTests} tests), ${skipped.length} skipped, ${failed.length} failed`,
);

// A green run must have executed something.
if (passedFiles === 0 || passedTests === 0) {
	console.error("root tests: no test was executed - the run is not meaningful");
	process.exit(1);
}

if (failed.length > 0) {
	console.error(`root tests: failing files: ${failed.join(", ")}`);
	process.exit(1);
}

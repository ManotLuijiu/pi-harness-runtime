#!/usr/bin/env node
/**
 * Run the harness/langchain test suite one file per process.
 *
 * Two reasons this exists instead of a plain `bun test harness/langchain/`:
 *
 * 1. `harness/langchain/` contains BOTH the compiled `*.test.js` and the
 *    `*.test.ts` sources, so a directory run executes every test twice and
 *    tests stale compiled code.
 * 2. One broken file must not take the whole run down with it (a file that
 *    leaks memory is OOM killed by the runner, which kills the run).
 *
 * The files in KNOWN_FAILING are reported but do not fail the run - they
 * are pre-existing breakage that is tracked separately:
 *
 * - daemon.test.ts : needs `node:sqlite`, which bun 1.3.14 does not have
 *                    (under node it times out waiting for the daemon event)
 *
 * A known-failing file is only excused when it fails WITHOUT a test
 * assertion failing (it crashed, timed out or was killed). If one of them
 * starts failing an assertion, that is a real regression and the run fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Files with pre-existing failures (see the module comment).
 *
 * `expect` is the failure signature: the file is only excused while it
 * fails in exactly this way. A different failure is a real regression.
 */
const KNOWN_FAILING = new Map([
	[
		"daemon.test.ts",
		{
			reason: "needs node:sqlite (missing in bun 1.3.14)",
			expect: /node:sqlite|waitFor timed out/i,
		},
	],
]);

const PER_FILE_TIMEOUT_MS = 180_000;
/**
 * The known-failing files get a short budget: surge.test.ts needs ~70 s to
 * be OOM killed, and there is no point burning that time in CI.
 */
const KNOWN_FAILING_TIMEOUT_MS = 25_000;

const root = join(import.meta.dirname, "..");
const suiteDir = join(root, "harness", "langchain");

if (!existsSync(suiteDir)) {
	console.error(`langchain tests: ${suiteDir} not found`);
	process.exit(1);
}

// bun is installed globally (not into node_modules/.bin), so use PATH.
const bun = process.env.BUN_BIN ?? "bun";
try {
	execFileSync(bun, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
} catch {
	console.error(
		`langchain tests: "${bun}" is not executable - install bun or set BUN_BIN`,
	);
	process.exit(1);
}

const files = readdirSync(suiteDir)
	.filter((name) => name.endsWith(".test.ts"))
	.sort();

if (files.length === 0) {
	console.error("langchain tests: no *.test.ts files found");
	process.exit(1);
}

/** A failing assertion inside the file output (as opposed to a crash). */
function hasAssertionFailure(output) {
	return /(^|\n)\s*\(fail\)|AssertionError/.test(output);
}

const known = [];
const failed = [];
const stale = [];
let passedFiles = 0;

for (const file of files) {
	const started = Date.now();
	const knownReason = KNOWN_FAILING.get(file)?.reason;
	const knownExpect = KNOWN_FAILING.get(file)?.expect;
	const timeout = knownReason
		? KNOWN_FAILING_TIMEOUT_MS
		: PER_FILE_TIMEOUT_MS;
	let output = "";
	let code = 0;
	let killed = false;
	try {
		output = execFileSync(bun, ["test", join(suiteDir, file)], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout,
			maxBuffer: 32 * 1024 * 1024,
		});
	} catch (error) {
		output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
		code = error.status ?? -1;
		killed = Boolean(error.killed) || error.signal !== undefined;
	}
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const summary = output
		.split("\n")
		.filter((line) => /pass|fail|Ran /.test(line))
		.slice(-3)
		.join(" | ");
	const how = killed
		? code === 0 || code === -1
			? "killed"
			: `exit ${code}`
		: `exit ${code}`;

	if (code === 0) {
		passedFiles++;
		console.log(`ok   ${file} (${seconds}s) ${summary.slice(0, 120)}`);
		continue;
	}

	// A known-failing file is only excused while it fails in exactly the
	// recorded way and without an assertion failing - anything else is a
	// real regression.
	if (knownReason && !hasAssertionFailure(output) && knownExpect?.test(output)) {
		known.push(`${file} (${knownReason})`);
		console.log(
			`known-failing ${file} (${seconds}s, ${how}) ${knownReason} | ${summary
				.slice(0, 120)
				.trim()}`,
		);
		continue;
	}

	failed.push(file);
	console.error(
		`FAIL ${file} (${seconds}s, ${how}) ${summary.slice(0, 200)}`,
	);
	if (!knownReason) {
		const tail = output.split("\n").slice(-40).join("\n");
		console.error(tail.trim());
	}
}

// A known-failing entry that no longer matches a file is stale.
for (const entry of KNOWN_FAILING.keys()) {
	if (!files.includes(entry)) stale.push(entry);
}
if (stale.length > 0) {
	console.warn(
		`langchain tests: stale known-failing entries (no such file): ${stale.join(", ")}`,
	);
}

console.log(
	`langchain tests: ${passedFiles}/${files.length} files passed, ${known.length} known-failing, ${failed.length} failed`,
);

if (failed.length > 0) {
	console.error(`langchain tests: failing files: ${failed.join(", ")}`);
	process.exit(1);
}

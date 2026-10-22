#!/usr/bin/env node
/**
 * Run the standalone e2e scripts in e2e/*.e2e.ts.
 *
 * These are scripts, not test files: they were named `*.test.ts`, which made
 * `bun test e2e/` pick them up - and because they call `process.exit(0)`
 * when the opt-in is missing, the first one aborted the whole test runner.
 * They are therefore named `*.e2e.ts` and are run by this script instead.
 *
 * They talk to the real world (Telegram, Qdrant, R2), so they only run when
 * PI_HARNESS_E2E=1 is set. CI never sets it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PER_SCRIPT_TIMEOUT_MS = 300_000;

const root = join(import.meta.dirname, "..");
const e2eDir = join(root, "e2e");
const bun = process.env.BUN_BIN ?? "bun";

if (!existsSync(e2eDir)) {
	console.error(`e2e scripts: ${e2eDir} not found`);
	process.exit(1);
}

const scripts = readdirSync(e2eDir)
	.filter((name) => name.endsWith(".e2e.ts"))
	.sort();

if (scripts.length === 0) {
	console.log("e2e scripts: no *.e2e.ts files found");
	process.exit(0);
}

if (process.env.PI_HARNESS_E2E !== "1") {
	console.log(
		`e2e scripts: SKIP (${scripts.length} scripts) - set PI_HARNESS_E2E=1 to run them against the real services`,
	);
	process.exit(0);
}

const failed = [];

for (const script of scripts) {
	const started = Date.now();
	let code = 0;
	try {
		execFileSync(bun, ["run", join(e2eDir, script)], {
			cwd: root,
			encoding: "utf8",
			stdio: "inherit",
			timeout: PER_SCRIPT_TIMEOUT_MS,
			maxBuffer: 32 * 1024 * 1024,
		});
	} catch (error) {
		code = error.status ?? -1;
	}
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	if (code === 0) {
		console.log(`ok   ${script} (${seconds}s)`);
		continue;
	}
	failed.push(script);
	console.error(`FAIL ${script} (${seconds}s, exit ${code})`);
}

if (failed.length > 0) {
	console.error(`e2e scripts: failing scripts: ${failed.join(", ")}`);
	process.exit(1);
}

console.log(`e2e scripts: ${scripts.length - failed.length}/${scripts.length} passed`);

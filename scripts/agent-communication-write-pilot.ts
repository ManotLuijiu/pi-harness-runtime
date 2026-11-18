#!/usr/bin/env bun
/**
 * The live pilot of the write lane.
 *
 * The pilot of the consultation proves that a worker answers a question
 * without changing the workspace. This pilot proves the other half: a
 * worker writes a plan down, and the harness applies exactly the file the
 * human named.
 *
 * The pilot runs against the real Codex of the machine, in a temporary
 * workspace:
 *
 * 1. the workspace has a `wiki/` directory and one file that is not
 *    allowed to change,
 * 2. the write lane is asked for one file, `wiki/plan.md`,
 * 3. the worker of the vendor writes into the copy of the workspace,
 * 4. the harness applies the named file into the workspace,
 * 5. the pilot reads the workspace again: the named file holds the plan of
 *    the worker, and nothing else of the tree has changed.
 *
 * A worker that writes outside the named files is a refusal, and the
 * pilot fails then: the lane has to apply nothing.
 *
 * ```bash
 * bun scripts/agent-communication-write-pilot.ts [--target codex|claude]
 * ```
 */

import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCommunicationRuntime } from "../harness/agent-communication/runtime.ts";
import { JobStore } from "../harness/agent-communication/store.ts";
import { writeThroughWorker } from "../harness/agent-communication/write-lane.ts";
import type { ConsultTarget } from "../harness/agent-communication/types.ts";

/**
 * The file the worker is asked to write.
 */
const PLAN = "wiki/plan.md";

/**
 * The question of the pilot.
 *
 * The question asks for a plan of three lines, so the file of the worker
 * has a shape the pilot can check.
 */
const QUESTION = [
	"Write a plan with exactly three bullet lines:",
	"- what the consultation of a worker is for,",
	"- what the copy of the workspace protects,",
	"- what the harness applies.",
	"Write nothing else.",
].join("\n");

const SENDER = {
	agentId: "write-pilot",
	sessionId: "write-pilot-session",
	generation: 1,
};

/**
 * The version of a binary.
 */
function versionOf(binary: string): string {
	try {
		return execFileSync(binary, ["--version"], {
			encoding: "utf8",
			timeout: 20_000,
		}).trim();
	} catch {
		return "not installed";
	}
}

/**
 * The run of the pilot.
 */
async function run(target: ConsultTarget): Promise<boolean> {
	const root = mkdtempSync(join(tmpdir(), "agent-write-pilot-"));
	const workspace = join(root, "workspace");
	const store = join(root, "store");
	mkdirSync(join(workspace, "wiki"), { recursive: true });
	// A file that the pilot does not name, and that must not change.
	writeFileSync(join(workspace, "wiki/notes.md"), "the notes of the user\n");
	const runtime = new AgentCommunicationRuntime({ store: new JobStore(store) });
	try {
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target,
			paths: [PLAN],
			prompt: QUESTION,
			sender: SENDER,
		});
		console.log(
			`[pilot] ${target}: status=${outcome.status} applied=${outcome.applied.length} touched=${outcome.touched.length}`,
		);
		if (outcome.diagnostic) console.log(`[pilot] ${target}: reason: ${outcome.diagnostic}`);
		if (outcome.status !== "written") {
			console.log(`[pilot] ${target}: the lane did not write the file.`);
			return false;
		}
		// The named file holds the plan of the worker.
		const plan = readFileSync(join(workspace, PLAN), "utf8");
		const lines = plan
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("-"));
		console.log(`[pilot] ${target}: the plan holds ${lines.length} line(s)`);
		if (lines.length !== 3) {
			console.log(`[pilot] ${target}: the plan does not hold three lines.`);
			return false;
		}
		// Nothing else of the tree has changed.
		const notes = readFileSync(join(workspace, "wiki/notes.md"), "utf8");
		if (notes !== "the notes of the user\n") {
			console.log(`[pilot] ${target}: the worker changed a file it was not named.`);
			return false;
		}
		// The worker wrote nothing else in the copy.
		const outside = outcome.touched.filter((path) => path !== PLAN);
		if (outside.length > 0) {
			console.log(
				`[pilot] ${target}: the worker wrote outside the named files: ${outside.join(", ")}`,
			);
			return false;
		}
		console.log(`[pilot] ${target}: the plan was applied and the tree is untouched.`);
		return true;
	} finally {
		await runtime.stop();
		rmSync(root, { recursive: true, force: true });
	}
}

/**
 * The run.
 */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const wanted = args.find((arg) => arg.startsWith("--target="));
	const target = wanted ? wanted.slice("--target=".length) : undefined;
	const targets: ConsultTarget[] =
		target === "codex" || target === "claude" ? [target] : ["codex"];

	console.log(`[pilot] codex: ${versionOf("codex")}`);
	console.log(`[pilot] claude: ${versionOf("claude")}`);
	console.log(`[pilot] node: ${process.version}`);

	for (const one of targets) {
		if (!(await run(one))) {
			console.log(`[pilot] ${one}: the route failed.`);
			process.exitCode = 1;
			return;
		}
	}
	console.log("[pilot] every route wrote its plan.");
}

await main();

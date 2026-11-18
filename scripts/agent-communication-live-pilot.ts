#!/usr/bin/env bun
/**
 * The live pilot of the consultation.
 *
 * The offline tests of the consultation use stand-ins for the vendored
 * CLIs. They prove the harness, not the interoperability: a stand-in
 * cannot show that Codex and Claude Code answer a question on this
 * machine.
 *
 * This pilot is the small measured run that proves the two routes:
 *
 * - one read-only consultation of Codex,
 * - one read-only consultation of Claude Code.
 *
 * The fixture is a temporary directory with one file that holds one
 * answer, and the question asks for that answer. The answer is
 * deterministic, so a run that returns something else is a failure of the
 * route and not a difference of the model.
 *
 * One job runs at a time. A failed pilot stops the run: the next step is
 * a fix, never a bigger pilot.
 *
 * ```bash
 * bun scripts/agent-communication-live-pilot.ts [--target codex|claude]
 * ```
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCommunicationRuntime } from "../harness/agent-communication/runtime.ts";
import { JobStore } from "../harness/agent-communication/store.ts";
import type { ConsultTarget } from "../harness/agent-communication/types.ts";

/**
 * The answer of the fixture.
 *
 * The answer is a fixed string: a pilot that reads something else did not
 * read the file.
 */
const EXPECTED = "harness-live-pilot-4711";

/**
 * The question of the pilot.
 *
 * The question asks for the content of one file and for nothing else.
 */
const QUESTION = `Read the file answer.txt in this workspace and reply with its exact content, and with nothing else. The file holds one line.`;

const SENDER = {
	agentId: "live-pilot",
	sessionId: "live-pilot-session",
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
	} catch (error) {
		return `unknown (${error instanceof Error ? error.message : String(error)})`;
	}
}

/**
 * The fixture of the pilot.
 */
function fixture(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "agent-live-pilot-"));
	writeFileSync(join(dir, "answer.txt"), `${EXPECTED}\n`, "utf8");
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/**
 * Run one route of the pilot.
 */
async function run(target: ConsultTarget, root: string): Promise<boolean> {
	const runtime = new AgentCommunicationRuntime({
		store: new JobStore(root),
		defaultTimeoutMs: 240_000,
	});
	const fixtureDir = fixture();
	try {
		const started = runtime.start({
			target,
			prompt: QUESTION,
			workspace: fixtureDir.dir,
			sender: SENDER,
		});
		if (started.status !== "running") {
			console.log(
				`[pilot] ${target}: the consultation did not start: ${started.diagnostic ?? started.status}`,
			);
			return false;
		}
		const result = await runtime.wait(started.jobId, 300_000);
		if (!result) {
			console.log(`[pilot] ${target}: no answer within the budget`);
			return false;
		}
		const answered = result.answer.includes(EXPECTED);
		console.log(
			`[pilot] ${target}: status=${result.status} job=${result.jobId} elapsed=${result.durationMs}ms answer=${
				answered ? "correct" : "wrong"
			}`,
		);
		if (result.answer.length > 0) {
			console.log(`[pilot] ${target}: response: ${result.answer.trim()}`);
		}
		if (result.diagnostic) {
			console.log(`[pilot] ${target}: reason: ${result.diagnostic}`);
		}
		return result.status === "completed" && answered;
	} finally {
		await runtime.stop();
		fixtureDir.cleanup();
	}
}

/**
 * The run.
 */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const wanted = args.find((arg) => arg.startsWith("--target="));
	const target = wanted ? wanted.slice("--target=".length) : undefined;
	const root = join(tmpdir(), "agent-live-pilot-store");
	const targets: ConsultTarget[] =
		target === "codex" || target === "claude" ? [target] : ["codex", "claude"];

	console.log(`[pilot] codex: ${versionOf("codex")}`);
	console.log(`[pilot] claude: ${versionOf("claude")}`);
	console.log(`[pilot] node: ${process.version}`);

	// Every route runs, also when one of them fails: the operator has to
	// see the state of all of them in one run, not the state of the first
	// one that failed.
	const results: { target: ConsultTarget; ok: boolean }[] = [];
	for (const one of targets) {
		results.push({ target: one, ok: await run(one, root) });
	}
	const failed = results.filter((result) => !result.ok);
	for (const one of failed) {
		console.log(`[pilot] ${one.target}: the route failed.`);
	}
	if (failed.length > 0) {
		console.log(
			`[pilot] ${results.length - failed.length}/${results.length} route(s) answered.`,
		);
		process.exitCode = 1;
		return;
	}
	console.log("[pilot] every route answered.");
}

await main();

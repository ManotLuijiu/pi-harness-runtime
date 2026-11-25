import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStateMachine, checkpointDirName } from "../harness/job-state-machine.ts";
import { stripTypeScriptTypes } from "./helpers/strip-types.mjs";

// Load the production factory and its real persistence imports without
// starting the extension's services or touching the user's harness state.
function loadFactory(root) {
	const entry = new URL("../index.ts", import.meta.url);
	const source = readFileSync(entry, "utf8");
	const factory = source.match(/^async function getCheckpointManager\([^]*?^\}/m)?.[0];
	assert.ok(factory, "the production checkpoint factory is missing");
	const imports = source.match(
		/^import\s*\{[^}]*\}\s*from\s*"\.\/harness\/job-state-machine\.ts";/m,
	)?.[0];
	assert.ok(imports, "the production persistence import is missing");
	const javascript = stripTypeScriptTypes(`${imports}\n${factory}`)
		.replace(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/, 'const {$1} = require("$2");')
		.replace(/\bimport\s*\(/g, "importModule(");
	return new Function("require", "HARNESS_ROOT_DIR", "importModule",
		`${javascript}\nreturn getCheckpointManager;`,
	)(
		createRequire(entry), root, (specifier) => import(new URL(specifier, entry).href),
	);
}

test("harness-start's production factory persists a new job and its events for resume", async () => {
	const root = await mkdtemp(join(tmpdir(), "harness-start-checkpoint-"));
	try {
		const getCheckpointManager = loadFactory(root);
		const manager = await getCheckpointManager();
		const machine = new JobStateMachine({ checkpointManager: manager });
		const jobId = "job-regression-143";
		const requirement = "Build a synthetic documentation CLI";
		const created = await machine.createJob(jobId, requirement);
		assert.equal(created.success, true, created.error);
		const directory = join(root, "checkpoints", checkpointDirName(jobId));
		const stored = JSON.parse(await readFile(join(directory, "checkpoint.json"), "utf8"));
		assert.equal(stored.jobId, jobId);
		assert.equal(stored.requirement, requirement);
		assert.equal(stored.status, "created");
		const events = (await readFile(join(directory, "events.jsonl"), "utf8"))
			.trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "JobCreated");
		assert.equal(events[0].jobId, jobId);
		const resumed = new JobStateMachine({ checkpointManager: await getCheckpointManager() });
		assert.equal((await resumed.resumeJob(jobId)).success, true);
		const planning = await resumed.transition("planning");
		assert.equal(planning.success, true, planning.error);
		assert.equal((await manager.load(jobId)).status, "planning");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

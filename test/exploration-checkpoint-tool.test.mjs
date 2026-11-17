/**
 * The tool that records the exploration checkpoint of the agent.
 *
 * The tool records what the agent found. It authorises nothing, writes
 * nothing and starts no task.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	EXPLORATION_CHECKPOINT_TOOL,
	explorationCheckpointTool,
} from "../harness/exploration-checkpoint-tool.ts";

/**
 * The recorder of a fixture.
 */
function recorder() {
	const recorded = [];
	return {
		recorded,
		recordCheckpoint(input) {
			recorded.push(input);
			return true;
		},
	};
}

test("the tool records what the agent reported", async () => {
	const calls = [];
	const tool = explorationCheckpointTool({
		current: () => ({
			recordCheckpoint(input) {
				calls.push(input);
				return true;
			},
		}),
	});

	const result = await tool.execute(
		"call-1",
		{
			findings: [
				{ statement: "the reset lives in the provider", locations: ["src/a.ts"] },
			],
			hypotheses: [{ statement: "the cookie is stale", rejected: true }],
			openQuestions: ["where is the reset read?"],
			nextAction: "read the reset parser",
			references: [{ path: "src/a.ts", contentHash: "abc123" }],
		},
		undefined,
		undefined,
		undefined,
	);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].nextAction, "read the reset parser");
	assert.equal(calls[0].findings.length, 1);
	assert.equal(calls[0].hypotheses[0].rejected, true);
	assert.deepEqual(calls[0].openQuestions, ["where is the reset read?"]);
	assert.equal(calls[0].references[0].contentHash, "abc123");
	assert.match(result.content[0].text, /recorded/);
});

test("the tool says so when no request is running", async () => {
	const tool = explorationCheckpointTool({ current: () => null });
	const result = await tool.execute(
		"call-1",
		{ findings: [{ statement: "a finding" }] },
		undefined,
		undefined,
		undefined,
	);
	assert.match(result.content[0].text, /no running request/);
});

test("the tool reports a checkpoint that could not be written", async () => {
	const tool = explorationCheckpointTool({
		current: () => ({
			recordCheckpoint() {
				return false;
			},
		}),
	});
	const result = await tool.execute(
		"call-1",
		{ findings: [{ statement: "a finding" }] },
		undefined,
		undefined,
		undefined,
	);
	assert.match(result.content[0].text, /could not be recorded/);
});

test("the tool authorises nothing", () => {
	const tool = explorationCheckpointTool({ current: () => null });
	assert.equal(tool.name, EXPLORATION_CHECKPOINT_TOOL);
	const text = `${tool.description} ${JSON.stringify(tool.parameters)}`;
	assert.ok(!text.includes("git commit"));
	assert.ok(!text.includes("npm publish"));
	assert.ok(!text.includes("bd close"));
});

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

test("the checkpoint of a handoff carries the identifiers of the handoff", async () => {
	// The identifiers are the evidence of the work of the handoff: the
	// record of the checkpoint names the issue of the store, the id of
	// the handoff and the correlation of the delivery that brought it,
	// and the result of the tool names the same three.
	const calls = [];
	const tool = explorationCheckpointTool({
		current: () => ({
			recordCheckpoint(input) {
				calls.push(input);
				return true;
			},
		}),
		link: () => ({
			bdIssueId: "bd-1",
			handoffId: "h1",
			correlationId: "c1",
		}),
	});

	const result = await tool.execute(
		"call-1",
		{ findings: [{ statement: "a finding" }] },
		undefined,
		undefined,
		undefined,
	);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].bdIssueId, "bd-1");
	assert.equal(calls[0].handoffId, "h1");
	assert.equal(calls[0].correlationId, "c1");
	assert.equal(result.details.bdIssueId, "bd-1");
	assert.equal(result.details.handoffId, "h1");
	assert.equal(result.details.correlationId, "c1");
	assert.equal(result.details.recorded, true);
});

test("the callback of the handoff may be asynchronous", async () => {
	// The todos of the request are read from the list of the session, and
	// the list is read asynchronously: the callback may answer with a
	// promise, and the identifiers are the ones of the answer.
	const calls = [];
	const tool = explorationCheckpointTool({
		current: () => ({
			recordCheckpoint(input) {
				calls.push(input);
				return true;
			},
		}),
		link: async () => ({ bdIssueId: "bd-2", handoffId: "h2" }),
	});

	await tool.execute(
		"call-1",
		{ findings: [{ statement: "a finding" }] },
		undefined,
		undefined,
		undefined,
	);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].bdIssueId, "bd-2");
	assert.equal(calls[0].handoffId, "h2");
	assert.equal(calls[0].correlationId, undefined);
});

test("a request that works on no handoff names no identifier", async () => {
	// The identifiers of a checkpoint are evidence. A request that works
	// on no handoff carries none, and the record of the checkpoint says
	// so instead of naming the issue of another request.
	const calls = [];
	const tool = explorationCheckpointTool({
		current: () => ({
			recordCheckpoint(input) {
				calls.push(input);
				return true;
			},
		}),
		link: () => null,
	});

	const result = await tool.execute(
		"call-1",
		{ findings: [{ statement: "a finding" }] },
		undefined,
		undefined,
		undefined,
	);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].bdIssueId, undefined);
	assert.equal(calls[0].handoffId, undefined);
	assert.equal(calls[0].correlationId, undefined);
	assert.equal(result.details.bdIssueId, undefined);
	assert.equal(result.details.handoffId, undefined);
	assert.equal(result.details.correlationId, undefined);
	assert.equal(result.details.recorded, true);
});

test("a tool without a callback of a handoff carries no identifier", async () => {
	const calls = [];
	const tool = explorationCheckpointTool({
		current: () => ({
			recordCheckpoint(input) {
				calls.push(input);
				return true;
			},
		}),
	});

	await tool.execute(
		"call-1",
		{ findings: [{ statement: "a finding" }] },
		undefined,
		undefined,
		undefined,
	);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].bdIssueId, undefined);
});

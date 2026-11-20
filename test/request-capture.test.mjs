/**
 * The capture of the work of a request.
 *
 * A request that asks for two things asks for two items of the task list.
 * One item of the list does not stand for the work that the request asks
 * for besides it, so the steps of the request are reconciled with the
 * list: the work that has no item is named.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	captureInstruction,
	stepsOfRequest,
	uncoveredSteps,
} from "../harness/request-capture.ts";

test("the steps of a request are the work it names", () => {
	const steps = stepsOfRequest(
		"Fix the failing test of the parser, add the missing documentation, and update the changelog",
	);
	assert.equal(steps.length, 3);
	assert.match(steps[0], /parser/i);
	assert.match(steps[1], /documentation/i);
	assert.match(steps[2], /changelog/i);
});

test("a request of one thing has one step", () => {
	assert.deepEqual(stepsOfRequest("Fix the failing test of the parser"), [
		"Fix the failing test of the parser",
	]);
});

test("a clause that continues the one before it is not a step", () => {
	const steps = stepsOfRequest(
		"Fix the failing test of the parser, which fails on an empty input",
	);
	assert.equal(steps.length, 1);
	assert.match(steps[0], /parser/i);
});

test("a request without work has no steps", () => {
	assert.deepEqual(stepsOfRequest(""), []);
	assert.deepEqual(stepsOfRequest(undefined), []);
	assert.deepEqual(stepsOfRequest("Thanks!"), []);
});

test("one item of the list does not cover the other steps", () => {
	const steps = stepsOfRequest(
		"Inspect the code of the parser, add the missing tests, and update the documentation",
	);
	// The agent recorded one item of the three steps.
	const todos = [{ subject: "Inspect the code", status: "in_progress" }];
	const missing = uncoveredSteps(steps, todos);
	assert.equal(missing.length, 2);
	assert.ok(
		missing.some((step) => /tests/i.test(step)),
		"the missing tests are named",
	);
	assert.ok(
		missing.some((step) => /documentation/i.test(step)),
		"the missing documentation is named",
	);
});

test("an item that names the step covers it", () => {
	const steps = stepsOfRequest(
		"Add the missing tests of the parser, and update the documentation",
	);
	const todos = [
		{ subject: "Add the missing tests of the parser", status: "pending" },
		{
			subject: "Update the documentation",
			description: "the documentation of the parser is outdated",
		},
	];
	assert.deepEqual(uncoveredSteps(steps, todos), []);
});

test("a list that cannot be read covers nothing", () => {
	const steps = stepsOfRequest("Add the missing tests");
	assert.equal(uncoveredSteps(steps, undefined).length, 1);
});

test("the instruction names the request and the steps that have no item", () => {
	const instruction = captureInstruction("Add the missing tests", [
		"Add the missing tests",
	]);
	assert.match(instruction, /Add the missing tests/);
	assert.match(instruction, /no item in the task list yet/i);
	assert.match(instruction, /todo/i);
	// The instruction asks for the work of this request and nothing else.
	assert.match(instruction, /Do not start unrelated backlog work/i);
});

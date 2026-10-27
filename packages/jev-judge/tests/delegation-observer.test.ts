/**
 * Tests for the children of a delegation.
 *
 * A child is a fact: the harness watches the tool events, so a child is
 * only recorded when its tool call was really made, and it carries what
 * the extension reported - never a model that was guessed.
 */

import { describe, it, expect } from "bun:test";
import {
	DelegationObserver,
	groupOfTask,
	modelFromResult,
	summarizeOutput,
} from "../src/delegation-observer.js";

describe("the observer of the children", () => {
	it("records a child of the current plan", () => {
		const observer = new DelegationObserver();
		observer.setPlan("subagent", ["packages/alpha", "packages/beta"]);

		const child = observer.noteStart({
			toolCallId: "call-1",
			toolName: "subagent",
			args: { task: "migrate packages/alpha to the new API" },
		});

		expect(child).not.toBeNull();
		expect(child?.toolCallId).toBe("call-1");
		expect(child?.groupId).toBe("packages/alpha");
		expect(child?.status).toBe("running");
		expect(observer.dispatchedCount).toBe(1);
	});

	it("ignores a tool that is not the dispatch of the plan", () => {
		const observer = new DelegationObserver();
		observer.setPlan("subagent", ["packages/alpha"]);

		const child = observer.noteStart({
			toolCallId: "call-2",
			toolName: "bash",
			args: { command: "ls" },
		});

		expect(child).toBeNull();
		expect(observer.dispatchedCount).toBe(0);
	});

	it("ignores a tool call before a plan was handed over", () => {
		const observer = new DelegationObserver();
		const child = observer.noteStart({
			toolCallId: "call-3",
			toolName: "subagent",
			args: { task: "work" },
		});
		expect(child).toBeNull();
	});

	it("closes a child with the state and the output of the call", () => {
		const observer = new DelegationObserver();
		observer.setPlan("subagent", ["packages/alpha"]);
		observer.noteStart({
			toolCallId: "call-4",
			toolName: "subagent",
			args: { task: "work on packages/alpha" },
		});

		const child = observer.noteEnd({
			toolCallId: "call-4",
			toolName: "subagent",
			result: { model: "some-model", output: "done" },
		});

		expect(child?.status).toBe("completed");
		expect(child?.endedAt).toBeGreaterThan(0);
		expect(child?.model).toBe("some-model");
		expect(child?.output).toContain("done");
	});

	it("marks a failed child as failed", () => {
		const observer = new DelegationObserver();
		observer.setPlan("subagent", []);
		observer.noteStart({
			toolCallId: "call-5",
			toolName: "subagent",
			args: { task: "work" },
		});
		const child = observer.noteEnd({
			toolCallId: "call-5",
			toolName: "subagent",
			result: { error: "boom" },
			isError: true,
		});
		expect(child?.status).toBe("failed");
	});

	it("ignores the end of a call that was never started", () => {
		const observer = new DelegationObserver();
		observer.setPlan("subagent", []);
		const child = observer.noteEnd({
			toolCallId: "unknown",
			toolName: "subagent",
			result: {},
		});
		expect(child).toBeNull();
	});
});

describe("the model of a child", () => {
	it("is the model the extension reported", () => {
		expect(modelFromResult({ model: "m" })).toBe("m");
		expect(modelFromResult({ result: { model: "n" } })).toBe("n");
	});

	it("is nothing when no model was reported", () => {
		expect(modelFromResult({ output: "done" })).toBeUndefined();
		expect(modelFromResult("text")).toBeUndefined();
		expect(modelFromResult(undefined)).toBeUndefined();
	});
});

describe("the output of a child", () => {
	it("is a bounded summary", () => {
		const summary = summarizeOutput({ output: "x".repeat(2000) });
		expect(summary?.length).toBeLessThanOrEqual(603);
		expect(summary?.endsWith("...")).toBe(true);
	});

	it("is nothing for an empty result", () => {
		expect(summarizeOutput(undefined)).toBeUndefined();
		expect(summarizeOutput(null)).toBeUndefined();
	});
});

describe("the group of a task", () => {
	it("is the group the task names", () => {
		expect(groupOfTask("work on packages/beta now", ["packages/alpha", "packages/beta"])).toBe(
			"packages/beta",
		);
	});

	it("is nothing when the task names no group", () => {
		expect(groupOfTask("work on something else", ["packages/alpha"])).toBeUndefined();
		expect(groupOfTask(undefined, ["packages/alpha"])).toBeUndefined();
	});
});

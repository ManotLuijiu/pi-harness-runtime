import { describe, expect, test } from "bun:test";
import {
	classifyShellCommand,
	observeToolCall,
} from "../src/observation.js";

describe("the observation of the read tool", () => {
	test("a read names the file and the range it covered", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts", offset: 10, limit: 20 } },
			{ toolName: "read", isError: false, result: { content: "x" } },
		);
		expect(observation?.kind).toBe("read");
		expect(observation?.source).toBe("known");
		expect(observation?.path).toBe("src/a.ts");
		expect(observation?.range).toEqual({ start: 10, end: 29, truncated: false });
		expect(observation?.failed).toBe(false);
	});

	test("a read without an offset starts at the first line", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts" } },
			{ toolName: "read", isError: false, result: { content: "a\nb\nc" } },
		);
		expect(observation?.range?.start).toBe(1);
		expect(observation?.range?.end).toBe(3);
	});

	test("a failed read observed nothing", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts" } },
			{ toolName: "read", isError: true, result: "no such file" },
		);
		expect(observation?.failed).toBe(true);
		expect(observation?.range).toBeUndefined();
	});

	test("a truncated read covers only the part that came back", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts" } },
			{
				toolName: "read",
				isError: false,
				result: {
					content: "a\nb",
					truncated: true,
					details: { truncation: { truncated: true, outputBytes: 4 } },
				},
			},
		);
		expect(observation?.truncated).toBe(true);
		expect(observation?.range?.truncated).toBe(true);
		expect(observation?.observedBytes).toBe(4);
	});

	test("a malformed input names no file", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: 42 } },
			{ toolName: "read", isError: false, result: { content: "x" } },
		);
		expect(observation?.path).toBeUndefined();
	});
});

describe("the observation of the search tools", () => {
	test("a grep names the pattern and the scope", () => {
		const observation = observeToolCall(
			{ toolName: "grep", input: { pattern: "todo", path: "src" } },
			{ toolName: "grep", isError: false, result: { content: "match" } },
		);
		expect(observation?.kind).toBe("search");
		expect(observation?.query).toBe("todo");
		expect(observation?.scope).toBe("src");
	});

	test("a find is a search as well", () => {
		const observation = observeToolCall(
			{ toolName: "find", input: { pattern: "*.ts" } },
			{ toolName: "find", isError: false, result: { content: "a.ts" } },
		);
		expect(observation?.kind).toBe("search");
		expect(observation?.query).toBe("*.ts");
	});
});

describe("the observation of the shell", () => {
	test("a cat is a read of a known file", () => {
		const observation = observeToolCall(
			{ toolName: "bash", input: { command: "cat src/a.ts" } },
			{ toolName: "bash", isError: false, result: { content: "x" } },
		);
		expect(observation?.kind).toBe("shell-read");
		expect(observation?.source).toBe("known");
		expect(observation?.path).toBe("src/a.ts");
	});

	test("an unknown command says nothing about the coverage of a file", () => {
		const observation = observeToolCall(
			{ toolName: "bash", input: { command: "npm run build" } },
			{ toolName: "bash", isError: false, result: { content: "x" } },
		);
		expect(observation?.source).toBe("unknown");
		expect(observation?.path).toBeUndefined();
	});

	test("a command that chains is not understood", () => {
		expect(classifyShellCommand("cat a.ts | grep x").kind).toBe("unknown");
		expect(classifyShellCommand("cat a.ts && rm b").kind).toBe("unknown");
		expect(classifyShellCommand("cat $(echo a)").kind).toBe("unknown");
	});

	test("a grep in the shell is a search", () => {
		const reading = classifyShellCommand("grep -rn todo src");
		expect(reading.kind).toBe("search");
		expect(reading.query).toBe("todo");
	});

	test("an empty command is unknown", () => {
		expect(classifyShellCommand("   ").kind).toBe("unknown");
	});
});

describe("the observation of an unknown tool", () => {
	test("a tool the guard does not know has an unknown source", () => {
		const observation = observeToolCall(
			{ toolName: "some_other_tool", input: { path: "src/a.ts" } },
			{ toolName: "some_other_tool", isError: false, result: "x" },
		);
		expect(observation?.source).toBe("unknown");
		expect(observation?.path).toBeUndefined();
	});

	test("a tool the guard does not know is not a read", () => {
		const observation = observeToolCall(
			{ toolName: "edit", input: { path: "src/a.ts" } },
			{ toolName: "edit", isError: false, result: "ok" },
		);
		expect(observation?.countsAsRead).toBe(false);
	});
});

describe("the observation of the result of Pi", () => {
	test("a result that carries text blocks is measured", () => {
		// Pi returns the content of a tool as an array of blocks.
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts" } },
			{
				toolName: "read",
				isError: false,
				result: { content: [{ type: "text", text: "a\nb\nc" }] },
			},
		);
		expect(observation?.observedBytes).toBe(5);
		expect(observation?.range?.start).toBe(1);
		expect(observation?.range?.end).toBe(3);
	});

	test("several text blocks are measured together", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts" } },
			{
				toolName: "read",
				isError: false,
				result: {
					content: [
						{ type: "text", text: "one" },
						{ type: "text", text: "two" },
					],
				},
			},
		);
		expect(observation?.observedBytes).toBe(7);
	});

	test("a block that carries no text contributes nothing", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts" } },
			{
				toolName: "read",
				isError: false,
				result: {
					content: [
						{ type: "image", data: "not text" },
						{ type: "text", text: "ab" },
					],
				},
			},
		);
		expect(observation?.observedBytes).toBe(2);
	});

	test("a truncated read covers the lines that came back", () => {
		// The source asked for a thousand lines and got two.
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts", limit: 1000 } },
			{
				toolName: "read",
				isError: false,
				result: {
					content: [{ type: "text", text: "a\nb" }],
					details: {
						truncation: {
							truncated: true,
							outputLines: 2,
							totalLines: 1000,
							outputBytes: 4,
						},
					},
				},
			},
		);
		expect(observation?.truncated).toBe(true);
		expect(observation?.range?.start).toBe(1);
		expect(observation?.range?.end).toBe(2);
		expect(observation?.observedBytes).toBe(4);
	});

	test("a truncated read without a known line count covers what came back", () => {
		const observation = observeToolCall(
			{ toolName: "read", input: { path: "src/a.ts", limit: 1000 } },
			{
				toolName: "read",
				isError: false,
				result: {
					content: [{ type: "text", text: "a\nb" }],
					truncated: true,
				},
			},
		);
		expect(observation?.range?.start).toBe(1);
		expect(observation?.range?.end).toBe(2);
	});
});

describe("the observation of a search", () => {
	test("a search is not a read", () => {
		const observation = observeToolCall(
			{ toolName: "grep", input: { pattern: "todo", path: "src" } },
			{ toolName: "grep", isError: false, result: { content: "x" } },
		);
		expect(observation?.kind).toBe("search");
		expect(observation?.countsAsRead).toBe(false);
	});
});

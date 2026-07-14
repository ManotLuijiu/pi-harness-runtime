/**
 * MCP Adapter Tests (RFC-0068)
 */

import { describe, it, expect } from "bun:test";
import { HARNESS_TOOLS, handleToolCall } from "../src/tools.js";
import type { MCPServerOptions } from "../src/types.js";

describe("MCP Tools", () => {
	it("exposes 4 harness tools", () => {
		expect(HARNESS_TOOLS).toHaveLength(4);
		const names = HARNESS_TOOLS.map((t) => t.name);
		expect(names).toContain("analyze_workspace");
		expect(names).toContain("search_memory");
		expect(names).toContain("list_skills");
		expect(names).toContain("invoke_skill");
	});

	it("analyze_workspace tool has correct schema", () => {
		const tool = HARNESS_TOOLS.find((t) => t.name === "analyze_workspace")!;
		expect(tool.inputSchema).toBeDefined();
		const schema = tool.inputSchema as { properties: Record<string, unknown> };
		expect(schema.properties.path).toBeDefined();
	});

	it("analyze_workspace returns error for non-existent path", async () => {
		const result = await handleToolCall("analyze_workspace", {
			path: "/nonexistent/path/12345",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("does not exist");
	});

	it("analyze_workspace detects frameworks in temp dir", async () => {
		const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
		const os = await import("os");
		const path = await import("node:path");
		const tmp = os.tmpdir();
		const testDir = path.join(tmp, "mcp-test-" + Date.now());
		mkdirSync(testDir);
		writeFileSync(path.join(testDir, "package.json"), "{}");

		const result = await handleToolCall("analyze_workspace", { path: testDir });
		rmSync(testDir, { recursive: true });

		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.frameworks).toContain("node");
	});

	it("search_memory returns stub response", async () => {
		const result = await handleToolCall("search_memory", {
			query: "frappe",
			limit: 3,
		});
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.note).toContain("runtime integration");
	});

	it("list_skills returns stub response", async () => {
		const result = await handleToolCall("list_skills", {});
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.note).toContain("runtime integration");
	});

	it("invoke_skill returns stub response", async () => {
		const result = await handleToolCall("invoke_skill", {
			name: "test-skill",
			trigger: { type: "keyword", value: "test" },
		});
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.skill).toBe("test-skill");
	});

	it("unknown tool returns error", async () => {
		const result = await handleToolCall("unknown_tool");
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Unknown tool");
	});
});

describe("MCPServerOptions", () => {
	it("has correct defaults", () => {
		const opts: MCPServerOptions = {};
		expect(opts.name).toBeUndefined();
		expect(opts.version).toBeUndefined();
	});
});

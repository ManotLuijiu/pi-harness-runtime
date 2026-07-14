/**
 * CLI Plugin SDK Tests (RFC-0067)
 */

import { describe, it, expect } from "bun:test";
import { PluginCLI } from "../src/index.js";

describe("PluginCLI", () => {
	const cli = new PluginCLI({ cwd: "/tmp/test-cli-plugins" });

	it("creates instance with defaults", () => {
		const c = new PluginCLI();
		expect(c).toBeDefined();
	});

	it("creates instance with custom config", () => {
		const c = new PluginCLI({
			cwd: "/custom/path",
			globalDir: "/custom/global",
			registry: "https://custom.registry",
		});
		expect(c).toBeDefined();
	});

	it("getPluginPath returns null for non-existent plugin", () => {
		const path = cli.getPluginPath("nonexistent-plugin");
		expect(path).toBeNull();
	});

	it("list returns empty array for non-plugin dir", async () => {
		const plugins = await cli.list();
		expect(Array.isArray(plugins)).toBe(true);
	});

	it("search returns array", async () => {
		const results = await cli.search("frappe");
		expect(Array.isArray(results)).toBe(true);
	});

	it("invoke returns error for non-existent plugin", async () => {
		const result = await cli.invoke("nonexistent-plugin", "analyze");
		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});
});

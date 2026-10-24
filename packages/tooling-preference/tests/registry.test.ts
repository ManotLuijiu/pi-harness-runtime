import { describe, expect, it } from "bun:test";
import { ToolingRequestRegistry } from "../src/registry.ts";

const request = {
	requestId: "biome-abc123",
	workspaceRoot: "/work/web",
	userKey: "user-1",
	frameworks: ["next"],
};

describe("ToolingRequestRegistry", () => {
	it("registers a proposal once", () => {
		const registry = new ToolingRequestRegistry();
		expect(registry.register(request)).toBe(true);
		expect(registry.register(request)).toBe(false);
		expect(registry.has(request.requestId)).toBe(true);
	});

	it("lets the first answer win", () => {
		const registry = new ToolingRequestRegistry();
		registry.register(request);

		const first = registry.claim(request.requestId, "yes", "telegram");
		expect(first?.resolution.preference).toBe("prefer_biome");
		expect(first?.request.workspaceRoot).toBe("/work/web");

		// The second click finds nothing - the first answer stays.
		expect(registry.claim(request.requestId, "no", "line")).toBeNull();
		expect(registry.resolutionOf(request.requestId)?.preference).toBe("prefer_biome");
	});

	it("maps a no to the current tools", () => {
		const registry = new ToolingRequestRegistry();
		registry.register(request);
		const claimed = registry.claim(request.requestId, "no", "line");
		expect(claimed?.resolution.preference).toBe("use_project_tools");
		expect(claimed?.resolution.channel).toBe("line");
	});

	it("refuses a claim for an unknown request", () => {
		const registry = new ToolingRequestRegistry();
		expect(registry.claim("biome-unknown", "yes")).toBeNull();
	});

	it("does not register a request that was already answered", () => {
		const registry = new ToolingRequestRegistry();
		registry.register(request);
		registry.claim(request.requestId, "no");
		expect(registry.register(request)).toBe(false);
	});
});

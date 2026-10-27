/**
 * Tests for the delegation assessment.
 *
 * The assessment may only report what it measured and what it read: the
 * scope comes from the measurement, the capability comes from the schema
 * of the tools, and a decision never claims a dispatch that did not
 * happen.
 */

import { describe, it, expect } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildDelegationSteer,
	createDelegationHarness,
	scopeFactsFromMeasurement,
	schemaPropertyNames,
	type ScopeFacts,
} from "../src/delegation-harness.js";
import type { ScopeMeasurement } from "../src/delegation-scope.js";

/** A tool with a schema. */
function tool(
	name: string,
	description: string,
	properties: string[],
): { name: string; description: string; parameters: unknown } {
	return {
		name,
		description,
		parameters: {
			type: "object",
			properties: Object.fromEntries(properties.map((property) => [property, { type: "string" }])),
		},
	};
}

/** An extension API that only knows the tools. */
function fakePi(
	tools: { name: string; description: string; parameters: unknown }[],
	active: string[],
): ExtensionAPI {
	return {
		getAllTools: () => tools,
		getActiveTools: () => active,
		getSessionName: () => "test-session",
	} as unknown as ExtensionAPI;
}

/** A task id that no earlier run used. */
let taskCounter = 0;
function uniqueTaskId(): string {
	taskCounter += 1;
	return `test-task-${process.pid}-${Date.now()}-${taskCounter}`;
}

/** A measurement with the given groups. */
function measurement(groupCount: number): ScopeMeasurement {
	const groups = Array.from({ length: groupCount }, (_, index) => ({
		id: `packages/pkg-${index + 1}`,
		files: [`packages/pkg-${index + 1}/index.ts`],
	}));
	return {
		files: groups.flatMap((group) => group.files),
		groups,
		workspaceFiles: 120,
		callSites: 12,
		fileTypes: { ts: groups.length },
		fingerprint: `fingerprint-${groupCount}`,
		matchedHints: ["packages/"],
		source: "request",
	};
}

describe("the schema of a tool", () => {
	it("names the properties of the object", () => {
		const names = schemaPropertyNames({
			type: "object",
			properties: { task: { type: "string" }, cwd: { type: "string" } },
		});
		expect(names.has("task")).toBe(true);
		expect(names.has("cwd")).toBe(true);
	});

	it("names the properties of a branch of a union", () => {
		const names = schemaPropertyNames({
			anyOf: [{ properties: { task: { type: "string" } } }, { properties: { prompt: {} } }],
		});
		expect(names.has("task")).toBe(true);
		expect(names.has("prompt")).toBe(true);
	});

	it("has no property for a schema that is not an object", () => {
		expect(schemaPropertyNames(undefined).size).toBe(0);
		expect(schemaPropertyNames("text").size).toBe(0);
	});
});

describe("the capability of the session", () => {
	it("is not found when a tool only carries the name of a sub-agent", async () => {
		const harness = createDelegationHarness(
			fakePi([tool("subagent", "runs a child", ["model"])], ["subagent"]),
		);
		expect(await harness.discoverCapability()).toBeNull();
	});

	it("is found when the schema shows that the tool dispatches a child", async () => {
		const harness = createDelegationHarness(
			fakePi(
				[tool("worker", "runs a sub-agent on a task", ["task"])],
				["worker"],
			),
		);
		const capability = await harness.discoverCapability();
		expect(capability).not.toBeNull();
		expect(capability?.toolName).toBe("worker");
		expect(capability?.verified).toBe(true);
	});

	it("claims the isolation only when the schema shows it", async () => {
		const without = createDelegationHarness(
			fakePi([tool("worker", "runs a sub-agent on a task", ["task"])], ["worker"]),
		);
		expect((await without.discoverCapability())?.supportsWorkIsolation).toBe(false);

		const withIsolation = createDelegationHarness(
			fakePi(
				[tool("worker", "runs a sub-agent on a task", ["task", "cwd", "timeoutMs"])],
				["worker"],
			),
		);
		const capability = await withIsolation.discoverCapability();
		expect(capability?.supportsWorkIsolation).toBe(true);
		expect(capability?.supportsCancellation).toBe(true);
	});

	it("is not verified when the tool is inactive", async () => {
		const harness = createDelegationHarness(
			fakePi([tool("worker", "runs a sub-agent on a task", ["task"])], []),
		);
		const capability = await harness.discoverCapability();
		expect(capability?.verified).toBe(false);
	});
});

describe("the assessment of a scope", () => {
	it("is not made for a scope that was not measured", () => {
		const harness = createDelegationHarness(fakePi([], []));
		const facts = scopeFactsFromMeasurement(measurement(0));
		expect(harness.shouldAssess(facts)).toBe(false);
	});

	it("is made for a measured scope", () => {
		const harness = createDelegationHarness(fakePi([], []));
		const facts = scopeFactsFromMeasurement(measurement(3));
		expect(harness.shouldAssess(facts)).toBe(true);
	});

	it("reports the measured groups of a delegation", async () => {
		const harness = createDelegationHarness(
			fakePi([tool("worker", "runs a sub-agent on a task", ["task"])], ["worker"]),
		);
		const facts = scopeFactsFromMeasurement(measurement(3));
		const decision = await harness.assess(facts, uniqueTaskId());
		expect(decision?.strategy).toBe("delegate");
		expect(decision?.workGroups).toHaveLength(3);
		expect(decision?.workGroups[0].id).toBe("packages/pkg-1");
		expect(decision?.dispatchTool).toBe("worker");
	});

	it("never claims a dispatch that did not happen", async () => {
		const harness = createDelegationHarness(
			fakePi([tool("worker", "runs a sub-agent on a task", ["task"])], ["worker"]),
		);
		const facts = scopeFactsFromMeasurement(measurement(3));
		const decision = await harness.assess(facts, uniqueTaskId());
		expect(decision?.dispatched).toBe(false);
	});

	it("keeps the work in the session when there is only one group", async () => {
		const harness = createDelegationHarness(
			fakePi([tool("worker", "runs a sub-agent on a task", ["task"])], ["worker"]),
			{ minFiles: 1, minCallSites: 1, minComponents: 2 },
		);
		const facts = scopeFactsFromMeasurement(measurement(1));
		const decision = await harness.assess(facts, uniqueTaskId());
		expect(decision?.strategy).toBe("single_agent");
		expect(decision?.reason).toMatch(/One measured group/);
	});

	it("keeps the work in the session when there is no dispatch tool", async () => {
		const harness = createDelegationHarness(fakePi([], []));
		const facts = scopeFactsFromMeasurement(measurement(3));
		const decision = await harness.assess(facts, uniqueTaskId());
		expect(decision?.strategy).toBe("unavailable");
		expect(decision?.workGroups).toEqual([]);
	});

	it("does not hand out more groups than a session can use", async () => {
		const harness = createDelegationHarness(
			fakePi([tool("worker", "runs a sub-agent on a task", ["task"])], ["worker"]),
		);
		const facts = scopeFactsFromMeasurement(measurement(20));
		const decision = await harness.assess(facts, uniqueTaskId());
		expect(decision?.strategy).toBe("single_agent");
		expect(decision?.reason).toMatch(/too many/);
	});
});

describe("the plan that is handed to the agent", () => {
	it("names the measured groups", () => {
		const message = buildDelegationSteer({
			strategy: "delegate",
			workGroups: [
				{ id: "packages/alpha", files: ["packages/alpha/index.ts", "packages/alpha/extra.ts"] },
				{ id: "packages/beta", files: ["packages/beta/index.ts"] },
			],
			dispatchTool: "worker",
		});
		expect(message).not.toBeNull();
		expect(message).toContain("packages/alpha (2 file(s))");
		expect(message).toContain("packages/beta (1 file(s))");
		expect(message).toContain("worker");
	});

	it("says that the harness did not dispatch the groups", () => {
		const message = buildDelegationSteer({
			strategy: "delegate",
			workGroups: [{ id: "packages/alpha", files: ["packages/alpha/index.ts"] }],
		});
		expect(message).toContain("it did not dispatch the groups itself");
	});

	it("is not built for a decision without a delegation", () => {
		expect(buildDelegationSteer(null)).toBeNull();
		expect(buildDelegationSteer({ strategy: "single_agent", workGroups: [] })).toBeNull();
		expect(
			buildDelegationSteer({ strategy: "delegate", workGroups: [] }),
		).toBeNull();
	});
});

describe("the facts of a measurement", () => {
	it("count the measured files and groups", () => {
		const facts = scopeFactsFromMeasurement(measurement(2));
		expect(facts.observedFiles).toBe(2);
		expect(facts.independentComponents).toBe(2);
		expect(facts.tightlyCoupled).toBe(false);
		expect(facts.estimatedFiles).toBe(120);
		expect(facts.fingerprint).toBe("fingerprint-2");
	});

	it("treat one group as tightly coupled", () => {
		const facts = scopeFactsFromMeasurement(measurement(1));
		expect(facts.tightlyCoupled).toBe(true);
	});

	it("carry the groups of the measurement", () => {
		const facts: ScopeFacts = scopeFactsFromMeasurement(measurement(2));
		expect(facts.workGroups).toHaveLength(2);
	});
});

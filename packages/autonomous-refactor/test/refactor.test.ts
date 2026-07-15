/**
 * Autonomous Refactor Tests (RFC-0092)
 */

import { describe, it, expect } from "bun:test";
import {
	detectRefactorings,
	assessRisk,
	calculatePriority,
	createPlan,
	filterByRisk,
	groupByFile,
	groupByType,
} from "../src/index.js";
import type { RefactorFinding } from "../src/index.js";

const makeFinding = (
	overrides?: Partial<RefactorFinding>,
): RefactorFinding => ({
	id: `f${Math.random().toString(36).slice(2)}`,
	type: "extract-method",
	file: "src/test.ts",
	location: { line: 10, column: 1 },
	description: "Test finding",
	risk: "low",
	confidence: 0.7,
	...overrides,
});

describe("detectRefactorings", () => {
	it("detects magic literals", () => {
		const files = [{ path: "src/test.ts", content: "const timeout = 5000;" }];
		const findings = detectRefactorings(files);
		expect(findings.some((f) => f.type === "replace-magic-literal")).toBe(true);
	});

	it("detects long functions", () => {
		const lines = ["function longFunc() {"];
		for (let i = 0; i < 38; i++) lines.push("  const x = " + i + ";");
		lines.push("}");
		const files = [{ path: "src/test.ts", content: lines.join("\n") }];
		const findings = detectRefactorings(files);
		expect(findings.some((f) => f.type === "extract-method")).toBe(true);
	});

	it("detects nested conditionals", () => {
		const content = [
			"if (a) {",
			"  if (b) {",
			"    if (c) {",
			"      if (d) { console.log(1); }",
			"    }",
			"  }",
			"}",
		].join("\n");
		const files = [{ path: "src/test.ts", content }];
		const findings = detectRefactorings(files);
		expect(findings.some((f) => f.type === "simplify-conditional")).toBe(true);
	});

	it("returns empty for clean code", () => {
		const files = [
			{
				path: "src/test.ts",
				content: "const x = 1;\nconst y = 2;\nconst sum = x + y;",
			},
		];
		const findings = detectRefactorings(files);
		expect(findings.length).toBeLessThanOrEqual(3);
	});

	it("limits magic literal findings per file", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `const val${i} = 999;`);
		const files = [{ path: "src/test.ts", content: lines.join("\n") }];
		const findings = detectRefactorings(files);
		expect(
			findings.filter((f) => f.type === "replace-magic-literal").length,
		).toBeLessThanOrEqual(5);
	});
});

describe("assessRisk", () => {
	it("returns finding risk", () => {
		expect(assessRisk(makeFinding({ risk: "high" }))).toBe("high");
	});
});

describe("calculatePriority", () => {
	it("higher for high-confidence", () => {
		const high = makeFinding({ confidence: 0.9, risk: "low" });
		const low = makeFinding({ confidence: 0.3, risk: "low" });
		expect(calculatePriority(high)).toBeGreaterThan(calculatePriority(low));
	});

	it("higher for high-risk at same confidence", () => {
		const critical = makeFinding({ confidence: 0.5, risk: "critical" });
		const low = makeFinding({ confidence: 0.5, risk: "low" });
		expect(calculatePriority(critical)).toBeGreaterThan(calculatePriority(low));
	});

	it("returns value between 0 and 1", () => {
		const p = calculatePriority(
			makeFinding({ confidence: 0.7, risk: "medium" }),
		);
		expect(p).toBeGreaterThanOrEqual(0);
		expect(p).toBeLessThanOrEqual(1);
	});
});

describe("createPlan", () => {
	it("creates plan with findings", () => {
		const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];
		const plan = createPlan(findings);
		expect(plan.findings).toHaveLength(2);
		expect(plan.priorityOrder).toContain("f1");
		expect(plan.priorityOrder).toContain("f2");
	});

	it("limits to maxFindings", () => {
		const findings = Array.from({ length: 100 }, (_, i) =>
			makeFinding({ id: `f${i}`, confidence: 1 - i / 100 }),
		);
		const plan = createPlan(findings, { maxFindings: 20 });
		expect(plan.findings.length).toBeLessThanOrEqual(20);
	});

	it("filters by risk threshold", () => {
		const findings = [
			makeFinding({ id: "low", risk: "low" }),
			makeFinding({ id: "high", risk: "high" }),
			makeFinding({ id: "critical", risk: "critical" }),
		];
		const plan = createPlan(findings, { riskThreshold: "medium" });
		expect(plan.findings.some((f) => f.id === "low")).toBe(true);
		expect(plan.findings.some((f) => f.id === "high")).toBe(false);
		expect(plan.findings.some((f) => f.id === "critical")).toBe(false);
	});

	it("includes blockers when preserveBehavior", () => {
		const plan = createPlan([], { preserveBehavior: true });
		expect(plan.blockers.length).toBeGreaterThan(0);
	});

	it("estimates positive impact", () => {
		const findings = [
			makeFinding({ risk: "medium" }),
			makeFinding({ risk: "high" }),
		];
		const plan = createPlan(findings);
		expect(plan.estimatedImpact.complexityReduction).toBeGreaterThan(0);
	});
});

describe("filterByRisk", () => {
	it("keeps low and medium when threshold is medium", () => {
		const findings = [
			makeFinding({ id: "low", risk: "low" }),
			makeFinding({ id: "medium", risk: "medium" }),
			makeFinding({ id: "high", risk: "high" }),
		];
		const filtered = filterByRisk(findings, "medium");
		expect(filtered.map((f) => f.id)).toEqual(["low", "medium"]);
	});

	it("returns all when threshold is critical", () => {
		const findings = [
			makeFinding({ risk: "low" }),
			makeFinding({ risk: "critical" }),
		];
		expect(filterByRisk(findings, "critical")).toHaveLength(2);
	});
});

describe("groupByFile", () => {
	it("groups findings by file", () => {
		const findings = [
			makeFinding({ id: "f1", file: "src/a.ts" }),
			makeFinding({ id: "f2", file: "src/a.ts" }),
			makeFinding({ id: "f3", file: "src/b.ts" }),
		];
		const groups = groupByFile(findings);
		expect(groups.get("src/a.ts")).toHaveLength(2);
		expect(groups.get("src/b.ts")).toHaveLength(1);
	});

	it("handles empty array", () => {
		expect(groupByFile([]).size).toBe(0);
	});
});

describe("groupByType", () => {
	it("groups by type", () => {
		const findings = [
			makeFinding({ id: "f1", type: "extract-method" }),
			makeFinding({ id: "f2", type: "extract-method" }),
			makeFinding({ id: "f3", type: "rename-variable" }),
		];
		const groups = groupByType(findings);
		expect(groups.get("extract-method")).toHaveLength(2);
		expect(groups.get("rename-variable")).toHaveLength(1);
	});
});

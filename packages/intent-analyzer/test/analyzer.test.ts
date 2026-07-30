import { describe, it } from "node:test";
import { IntentAnalyzer } from "../src/analyzer.js";
import { equal } from "node:assert";

describe("IntentAnalyzer", () => {
	const analyzer = new IntentAnalyzer();

	it("detects bug_fix from fix keyword", () => {
		const result = analyzer.analyze("fix the login bug on line 42");
		equal(result.kind, "bug_fix");
	});

	it("detects feature from add keyword", () => {
		const result = analyzer.analyze("add dark mode support");
		equal(result.kind, "feature");
	});

	it("detects refactor from refactor keyword", () => {
		const result = analyzer.analyze("refactor the auth module");
		equal(result.kind, "refactor");
	});

	it("detects testing from test keyword", () => {
		const result = analyzer.analyze("write tests for the payment module");
		equal(result.kind, "testing");
	});

	it("detects deployment from deploy keyword", () => {
		const result = analyzer.analyze("deploy to production");
		equal(result.kind, "deployment");
	});

	it("detects security from security keyword", () => {
		const result = analyzer.analyze("fix the auth vulnerability");
		equal(result.kind, "security");
	});

	it("detects performance from optimize keyword", () => {
		const result = analyzer.analyze("optimize the database query");
		equal(result.kind, "performance");
	});

	it("detects architecture from architecture keyword", () => {
		const result = analyzer.analyze("review the architecture design");
		equal(result.kind, "architecture");
	});

	it("detects migration from migrate keyword", () => {
		const result = analyzer.analyze("migrate to TypeScript");
		equal(result.kind, "migration");
	});

	it("falls back to general for unknown text", () => {
		const result = analyzer.analyze("hello world");
		equal(result.kind, "general");
	});

	it("returns matched signals", () => {
		const result = analyzer.analyze("fix the authentication bug");
		equal(
			result.signals.some((s) => s.keyword === "fix"),
			true,
		);
	});

	it("analyzeBatch returns multiple intents", () => {
		const results = analyzer.analyzeBatch(["fix bug", "add feature"]);
		equal(results.length, 2);
		equal(results[0].kind, "bug_fix");
		equal(results[1].kind, "feature");
	});
});

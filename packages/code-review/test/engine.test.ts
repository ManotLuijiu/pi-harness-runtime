/**
 * Code Review Engine - Tests
 */

import { describe, it, expect } from "bun:test";
import { createCodeReviewEngine, SDK_VERSION } from "../src/index.js";

describe("CodeReviewEngine", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createCodeReviewEngine", () => {
		it("should create a code review engine instance", () => {
			const engine = createCodeReviewEngine();
			expect(engine).toBeDefined();
		});
	});

	describe("default rules", () => {
		const engine = createCodeReviewEngine();

		it("should have default rules", () => {
			const rules = engine.getRules();
			expect(rules.length).toBeGreaterThan(0);
		});
	});

	describe("code review", () => {
		const engine = createCodeReviewEngine();

		it("should detect eval usage", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `const result = eval(userInput);`,
					},
				],
			});

			expect(result.issues.some((i) => i.rule === "security/no-eval")).toBe(
				true,
			);
		});

		it("should detect console statements", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `console.log("debug");`,
					},
				],
			});

			expect(
				result.issues.some((i) => i.rule === "best-practice/no-console"),
			).toBe(true);
		});

		it("should detect innerHTML usage", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `element.innerHTML = "<b>bold</b>";`,
					},
				],
			});

			expect(
				result.issues.some((i) => i.rule === "security/no-inner-html"),
			).toBe(true);
		});

		it("should detect sync file I/O", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `const data = fs.readFileSync("file.txt");`,
					},
				],
			});

			expect(result.issues.some((i) => i.rule === "performance/no-sync")).toBe(
				true,
			);
		});

		it("should return summary statistics", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `console.log("test");`,
					},
				],
			});

			expect(result.summary).toBeDefined();
			expect(result.summary.total).toBeGreaterThanOrEqual(0);
		});

		it("should return review statistics", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `const x = 1;`,
					},
				],
			});

			expect(result.stats).toBeDefined();
			expect(result.stats.filesReviewed).toBe(1);
			expect(result.stats.linesReviewed).toBeGreaterThan(0);
		});
	});

	describe("custom rules", () => {
		const engine = createCodeReviewEngine();

		it("should add custom rules", () => {
			engine.addRule({
				id: "custom/no-bad-words",
				name: "No bad words",
				severity: "warning",
				category: "style",
				description: "Avoid certain words",
				pattern: "\\bTODO\\b",
			});

			const rules = engine.getRules();
			expect(rules.some((r) => r.id === "custom/no-bad-words")).toBe(true);
		});

		it("should add multiple rules", () => {
			engine.addRules([
				{
					id: "custom/rule-1",
					name: "Rule 1",
					severity: "info",
					category: "style",
					description: "Test rule 1",
					pattern: "test1",
				},
				{
					id: "custom/rule-2",
					name: "Rule 2",
					severity: "info",
					category: "style",
					description: "Test rule 2",
					pattern: "test2",
				},
			]);

			const rules = engine.getRules();
			expect(rules.some((r) => r.id === "custom/rule-1")).toBe(true);
			expect(rules.some((r) => r.id === "custom/rule-2")).toBe(true);
		});

		it("should apply custom rules", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `TODO: Fix this later`,
					},
				],
			});

			expect(result.issues.some((i) => i.rule === "style/no-todo")).toBe(true);
		});
	});

	describe("custom matchers", () => {
		const engine = createCodeReviewEngine();

		it("should register custom matcher", async () => {
			engine.registerCustomMatcher("complexity", (file) => {
				const issues = [];
				if (file.content.includes("function veryLongFunctionName")) {
					issues.push({
						id: "complex/function-name",
						severity: "warning",
						category: "maintainability",
						title: "Long function name",
						message: "Function name is very long",
						file: file.path,
					});
				}
				return issues;
			});

			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `function veryLongFunctionNameThatDoesALotOfStuff() {}`,
					},
				],
			});

			expect(result.issues.some((i) => i.id === "complex/function-name")).toBe(
				true,
			);
		});
	});

	describe("reports", () => {
		const engine = createCodeReviewEngine();

		it("should generate JSON report", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `console.log("test");`,
					},
				],
			});

			const report = engine.generateReport(result, { format: "json" });
			expect(typeof report).toBe("string");
			expect(() => JSON.parse(report)).not.toThrow();
		});

		it("should generate text report", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `console.log("test");`,
					},
				],
			});

			const report = engine.generateReport(result, { format: "text" });
			expect(typeof report).toBe("string");
			expect(report).toContain("CODE REVIEW REPORT");
		});

		it("should generate markdown report", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `console.log("test");`,
					},
				],
			});

			const report = engine.generateReport(result, { format: "markdown" });
			expect(typeof report).toBe("string");
			expect(report).toContain("# Code Review Report");
		});

		it("should generate HTML report", async () => {
			const result = await engine.review({
				files: [
					{
						path: "test.js",
						content: `console.log("test");`,
					},
				],
			});

			const report = engine.generateReport(result, { format: "html" });
			expect(typeof report).toBe("string");
			expect(report).toContain("<!DOCTYPE html>");
		});
	});

	describe("rule sets", () => {
		const engine = createCodeReviewEngine();

		it("should add rule set", () => {
			engine.addRuleSet({
				name: "strict-security",
				description: "Strict security rules",
				rules: [
					{
						id: "strict/no-eval",
						name: "No eval (strict)",
						severity: "error",
						category: "security",
						description: "eval is forbidden",
						pattern: "\\beval\\s*\\(",
					},
				],
			});

			const rules = engine.getRules();
			expect(rules.some((r) => r.id === "strict/no-eval")).toBe(true);
		});
	});
});

/**
 * Test Generator Tests (RFC-0013)
 */

import { describe, it, expect } from "bun:test";
import {
  detectAssertions,
  generateUnitTests,
  generateE2ETests,
  generateMockFixtures,
} from "../src/index.js";
import type { SourceFile, TestScenario } from "../src/index.js";

const src = (content: string): SourceFile => ({
  path: "src/math.ts",
  content,
  language: "typescript",
});

describe("detectAssertions", () => {
  it("detects .toBe", () => {
    const s = src("expect(result).toBe(42);");
    const assertions = detectAssertions(s);
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions[0].type).toBe("equality");
  });

  it("detects .toEqual", () => {
    const s = src("expect(result).toEqual({ ok: true });");
    const assertions = detectAssertions(s);
    expect(assertions.some((a) => a.type === "equality")).toBe(true);
  });

  it("detects .toThrow", () => {
    const s = src("expect(() => run()).toThrow();");
    const assertions = detectAssertions(s);
    expect(assertions.some((a) => a.type === "exception")).toBe(true);
  });

  it("detects truthiness", () => {
    const s = src("expect(value).toBeTruthy();");
    const assertions = detectAssertions(s);
    expect(assertions.some((a) => a.type === "truthiness")).toBe(true);
  });

  it("returns empty for clean code", () => {
    const s = src("const x = 1; const y = 2;");
    expect(detectAssertions(s).length).toBe(0);
  });

  it("includes line number", () => {
    const s = src("const x = 1;\nexpect(x).toBe(1);");
    const assertions = detectAssertions(s);
    expect(assertions[0].line).toBe(2);
  });
});

describe("generateUnitTests", () => {
  it("generates test content", () => {
    const s = src("export function add(a: number, b: number): number { return a + b; }");
    const test = generateUnitTests(s);
    expect(test.content).toContain("describe(");
    expect(test.content).toContain("it(");
    expect(test.fileName).toContain(".test.ts");
  });

  it("uses bun test imports by default", () => {
    const s = src("function fn() {}");
    const test = generateUnitTests(s);
    expect(test.content).toContain('from "bun:test"');
  });

  it("uses vitest for vitest framework", () => {
    const s = src("function fn() {}");
    const test = generateUnitTests(s, "vitest");
    expect(test.content).toContain("vitest");
  });

  it("uses playwright for playwright framework", () => {
    const s = src("function fn() {}");
    const test = generateUnitTests(s, "playwright");
    expect(test.content).toContain("playwright");
    expect(test.testCount).toBeGreaterThan(0);
  });

  it("extracts function name", () => {
    const s = src("export const multiply = (a: number, b: number) => a * b;");
    const test = generateUnitTests(s);
    expect(test.content).toContain("multiply");
  });

  it("handles anonymous function", () => {
    const s = src("const fn = function() {};");
    const test = generateUnitTests(s);
    expect(test.content).toContain("describe(");
  });
});

describe("generateE2ETests", () => {
  it("generates playwright test from scenario", () => {
    const scenario: TestScenario = {
      name: "Login Flow",
      description: "User logs in",
      steps: [
        "navigate:https://example.com/login",
        "click:#username",
        "assert:.error",
      ],
      expectedResult: "User sees login form",
      mockFixtures: [],
    };
    const tests = generateE2ETests([scenario]);
    expect(tests).toHaveLength(1);
    expect(tests[0].content).toContain("Login Flow");
    expect(tests[0].framework).toBe("playwright");
  });

  it("generates correct step content", () => {
    const scenario: TestScenario = {
      name: "Navigate",
      description: "",
      steps: ["navigate:https://example.com"],
      expectedResult: "",
      mockFixtures: [],
    };
    const tests = generateE2ETests([scenario]);
    expect(tests[0].content).toContain('page.goto("https://example.com")');
  });
});

describe("generateMockFixtures", () => {
  it("extracts typed variables", () => {
    const s = src("const name: string = 'Alice'; const count: number = 42;");
    const fixtures = generateMockFixtures(s);
    expect(fixtures.some((f) => f.name === "name" && f.type === "string")).toBe(true);
    expect(fixtures.some((f) => f.name === "count" && f.type === "number")).toBe(true);
  });

  it("maps types to values", () => {
    const s = src("const flag: boolean = true;");
    const fixtures = generateMockFixtures(s);
    expect(fixtures[0].value).toBe("true");
  });

  it("defaults unknown types to null", () => {
    const s = src("const custom: CustomType = x;");
    const fixtures = generateMockFixtures(s);
    expect(fixtures[0].value).toBe("null");
  });
});

/**
 * Test Generator Core — assertion detection, test generation (RFC-0013)
 */

import type { SourceFile, Assertion, GeneratedTest, TestFramework, TestScenario, MockFixture } from "./types.js";

/** Detect assertions in source code. */
export function detectAssertions(source: SourceFile): Assertion[] {
  const assertions: Assertion[] = [];
  const lines = source.content.split("\n");
  const patterns: Array<[RegExp, Assertion["type"]]> = [
    [/>=\s*\(|<=\s*\(|>\s*\(/, "comparison"],
    [/\.toBe\(/, "equality"],
    [/\.toEqual\(/, "equality"],
    [/\.toThrow\(/, "exception"],
    [/\.toBeTruthy\(\)|\.toBeFalsy\(\)/, "truthiness"],
    [/assert\(|expect\(/, "custom"],
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [pattern, type] of patterns) {
      if (pattern.test(line)) {
        assertions.push({
          type,
          expression: line.trim(),
          line: i + 1,
          expected: undefined,
        });
        pattern.lastIndex = 0;
      }
    }
  }
  return assertions;
}

/** Extract a function name from source content. */
function extractFunctionName(content: string): string | undefined {
  const match = content.match(
    /(?:function\s+(\w+)|export\s+const\s+(\w+)|(\w+)\s*=\s*(?:async\s*)?\()/,
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/** Get framework-specific imports. */
function getImports(framework: TestFramework): string {
  if (framework === "playwright") return 'import { test, expect } from "@playwright/test";';
  if (framework === "bun") return 'import { describe, it, expect } from "bun:test";';
  return 'import { describe, it, expect } from "vitest";';
}

/** Generate test blocks for a function. */
function generateTestBlocks(fnName: string, framework: TestFramework): string[] {
  const names = ["basic input", "edge case", "error case"];
  return names.map((name, i) => {
    if (framework === "playwright") {
      return `test("${fnName} — ${name}", async ({ page }) => {\n  await page.goto("about:blank");\n});`;
    }
    return `it("${fnName} — ${name}", () => {\n  const result = ${fnName}();\n  expect(result).toBeDefined();\n});`;
  });
}

/** Generate unit tests from a source file. */
export function generateUnitTests(source: SourceFile, framework: TestFramework = "bun"): GeneratedTest {
  const fnName = extractFunctionName(source.content) ?? "underTest";
  const imports = getImports(framework);
  const testBlocks = generateTestBlocks(fnName, framework);

  return {
    fileName: source.path.replace(/\.[^.]+$/, ".test.ts"),
    content: [
      imports,
      "",
      `describe("${fnName}", () => {`,
      ...testBlocks.map((b) => `  ${b}`),
      "});",
    ].join("\n"),
    framework,
    testCount: testBlocks.length,
  };
}

/** Generate E2E Playwright tests from scenarios. */
export function generateE2ETests(scenarios: TestScenario[]): GeneratedTest[] {
  return scenarios.map((scenario) => ({
    fileName: `e2e/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.test.ts`,
    content: [
      'import { test, expect } from "@playwright/test";',
      "",
      `test.describe("${scenario.name}", () => {`,
      ...scenario.steps.map((step, i) => {
        if (step.startsWith("navigate:")) {
          return `  test("step ${i + 1}", async ({ page }) => {\n    await page.goto("${step.slice(9)}");\n  });`;
        }
        if (step.startsWith("click:")) {
          return `  test("step ${i + 1}", async ({ page }) => {\n    await page.click("${step.slice(6)}");\n  });`;
        }
        if (step.startsWith("assert:")) {
          return `  test("step ${i + 1}", async ({ page }) => {\n    await expect(page.locator("${step.slice(7)}")).toBeVisible();\n  });`;
        }
        return `  test("step ${i + 1}", async ({ page }) => {\n  await page.evaluate(() => {});\n});`;
      }),
      "});",
    ].join("\n"),
    framework: "playwright" as TestFramework,
    testCount: scenario.steps.length,
  }));
}

/** Generate mock fixtures from source variables. */
export function generateMockFixtures(source: SourceFile): MockFixture[] {
  const typeMap: Record<string, string> = {
    string: '"mock-string"',
    number: "42",
    boolean: "true",
    object: "{ mock: true }",
    array: "[]",
    function: "() => {}",
  };

  const fixtures: MockFixture[] = [];
  for (const match of source.content.matchAll(/(?:const|let|var)\s+(\w+)\s*:\s*(\w+)/g)) {
    const [, name, type] = match;
    fixtures.push({ name, type, value: typeMap[type.toLowerCase()] ?? "null" });
  }
  return fixtures;
}

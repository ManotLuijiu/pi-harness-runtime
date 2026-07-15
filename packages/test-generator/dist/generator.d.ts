/**
 * Test Generator Core — assertion detection, test generation (RFC-0013)
 */
import type { SourceFile, Assertion, GeneratedTest, TestFramework, TestScenario, MockFixture } from "./types.js";
/** Detect assertions in source code. */
export declare function detectAssertions(source: SourceFile): Assertion[];
/** Generate unit tests from a source file. */
export declare function generateUnitTests(source: SourceFile, framework?: TestFramework): GeneratedTest;
/** Generate E2E Playwright tests from scenarios. */
export declare function generateE2ETests(scenarios: TestScenario[]): GeneratedTest[];
/** Generate mock fixtures from source variables. */
export declare function generateMockFixtures(source: SourceFile): MockFixture[];
//# sourceMappingURL=generator.d.ts.map
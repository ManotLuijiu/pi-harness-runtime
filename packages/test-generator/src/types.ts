/**
 * Test Generator Types (RFC-0013)
 */

export interface SourceFile {
	path: string;
	content: string;
	language: string;
}

export interface Assertion {
	type: "equality" | "comparison" | "truthiness" | "exception" | "custom";
	expression: string;
	expected?: string;
	line: number;
}

export interface TestScenario {
	name: string;
	description: string;
	steps: string[];
	expectedResult: string;
	mockFixtures: string[];
}

export interface GeneratedTest {
	fileName: string;
	content: string;
	framework: TestFramework;
	testCount: number;
}

export type TestFramework = "bun" | "jest" | "vitest" | "playwright";

export interface MockFixture {
	name: string;
	type: string;
	value: string;
}

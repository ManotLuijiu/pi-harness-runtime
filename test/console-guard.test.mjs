/**
 * Console guard tests - the TUI must keep its prompt input field clean.
 */

import { test, expect } from "bun:test";
import { installConsoleGuard, formatConsoleArgs } from "../harness/console-guard.ts";

test("every console method is redirected to the sink", () => {
	const seen = [];
	const restore = installConsoleGuard({
		sink: (level, message) => seen.push(`${level}: ${message}`),
	});

	console.log("hello", { a: 1 });
	console.warn("careful");
	console.error("boom");
	restore();

	expect(seen).toEqual(['log: hello {"a":1}', "warn: careful", "error: boom"]);
});

test("the restore function brings the original console back", () => {
	const original = console.log;
	const restore = installConsoleGuard({ sink: () => {} });

	expect(console.log).not.toBe(original);
	restore();
	expect(console.log).toBe(original);
});

test("a failing sink never breaks the caller", () => {
	const restore = installConsoleGuard({
		sink: () => {
			throw new Error("sink is broken");
		},
	});

	expect(() => console.log("still fine")).not.toThrow();
	restore();
});

test("an error argument keeps its stack", () => {
	const error = new Error("nope");
	const formatted = formatConsoleArgs([error]);
	expect(formatted).toContain("nope");
	expect(formatted).toContain("Error");
	expect(formatConsoleArgs(["a", 1, true])).toBe("a 1 true");
});

test("a level that was absent before is removed again", () => {
	const original = console.debug;
	const restore = installConsoleGuard({ sink: () => {} });
	expect(console.debug).not.toBe(original);
	restore();
	expect(console.debug).toBe(original);
});

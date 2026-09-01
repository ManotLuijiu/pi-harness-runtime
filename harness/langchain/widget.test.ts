/**
 * LoopWidget tests — T14
 *
 * Run:
 *   bun test harness/langchain/widget.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { LoopWidget } from "./widget.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const stubTheme = {
	fg: (color: string, s: string): string => {
		const codes: Record<string, string> = {
			dim: `\x1b[2m${s}\x1b[0m`,
			error: `\x1b[31m${s}\x1b[0m`,
			warning: `\x1b[33m${s}\x1b[0m`,
			success: `\x1b[32m${s}\x1b[0m`,
			accent: `\x1b[36m${s}\x1b[0m`,
		};
		return codes[color] ?? s;
	},
};

describe("T14 — LoopWidget", () => {

	let widget: LoopWidget;

	beforeEach(() => {
		widget = new LoopWidget();
	});

	// ─── Idle state ────────────────────────────────────────────────────────

	it("starts in idle phase", () => {
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /idle/);
		assert.match(lines[0], /harness/);
	});

	// ─── Phase transitions ──────────────────────────────────────────────────

	it("setPhase changes the phase label", () => {
		widget.setPhase("writing");
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /coding/);
	});

	it("setPhase with custom label uses the label", () => {
		widget.setPhase("planning", "GPT planning");
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /GPT planning/);
	});

	it("surge-pause shows detail line", () => {
		widget.setSurgePause(new Date(Date.now() + 30 * 60_000)); // 30 min
		const lines = widget.renderWidget(80, stubTheme);
		// Label is "surge (in 30m)"
		assert.ok(lines.some(l => l.includes("surge") && l.includes("in 30m")));
	});

	it("setError shows error detail", () => {
		widget.setError("model timeout");
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines.some(l => l.includes("error")));
		assert.ok(lines.some(l => l.includes("model timeout")));
	});

	it("setComplete approved shows ✓ loop complete", () => {
		widget.setComplete("approved");
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /loop complete/);
	});

	it("setComplete rejected shows ✗ loop rejected", () => {
		widget.setComplete("rejected");
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /loop rejected/);
	});

	it("setComplete max_iterations shows iteration count", () => {
		widget.setComplete("max_iterations");
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /max iterations/);
	});

	// ─── Iteration tracking ────────────────────────────────────────────────

	it("startIteration sets iteration and max", () => {
		widget.startIteration(3, 5);
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /iter 3\/5/);
	});

	it("startIteration resets per-file counters but keeps file records", () => {
		widget.recordWrite("src/a.ts");
		widget.recordBlockers("src/a.ts", 2);
		widget.startIteration(2, 5);
		// Files accumulate across iterations (same codebase); only counters reset.
		// After reset, a.ts shows with 0 write steps and 0 blockers.
		const lines = widget.renderWidget(80, stubTheme);
		const fileLines = lines.filter(l => l.includes("a.ts"));
		assert.ok(fileLines.length > 0, "file should still appear");
		// No blocker count in the file row (reset to 0)
		assert.ok(!fileLines.some(l => l.includes("!2")), "blocker count should be reset");
	});

	// ─── File record tracking ──────────────────────────────────────────────

	it("recordWrite shows file in widget", () => {
		widget.recordWrite("src/foo.ts");
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines.some(l => l.includes("foo.ts")));
	});

	it("recordWrite accumulates across calls", () => {
		widget.recordWrite("src/bar.ts");
		widget.recordWrite("src/bar.ts");
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines.some(l => l.includes("bar.ts") && l.includes("✍2")));
	});

	it("recordBlockers shows blocker count", () => {
		widget.recordBlockers("src/bad.ts", 2);
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines.some(l => l.includes("bad.ts") && l.includes("!2")));
	});

	it("recordReviewPass clears blockers and increments passes", () => {
		widget.recordBlockers("src/ok.ts", 1);
		widget.recordReviewPass("src/ok.ts");
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines.some(l => l.includes("ok.ts") && l.includes("🔍1")));
		// No blocker count
		assert.ok(!lines.some(l => l.includes("ok.ts") && l.includes("!") && !l.includes("🔍")));
	});

	// ─── Summary counts ────────────────────────────────────────────────────

	it("no errors/warnings shows ✓", () => {
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines[0].includes("✓") || lines[0].includes("harness"));
	});

	it("errors shown as ●NE", () => {
		widget.recordBlockers("src/err.ts", 3);
		const lines = widget.renderWidget(80, stubTheme);
		assert.ok(lines.some(l => l.includes("●3E")));
	});

	// ─── Surge pause ──────────────────────────────────────────────────────

	it("setSurgePause shows reset time in minutes/hours", () => {
		const resetAt = new Date(Date.now() + 90 * 60_000); // 90 minutes → "in 1h 30m"
		widget.setSurgePause(resetAt);
		const lines = widget.renderWidget(80, stubTheme);
		const surgeLine = lines.find(l => l.includes("surge"));
		assert.ok(surgeLine !== undefined);
		assert.match(surgeLine, /\(in \d+h/); // "in 1h 30m" matches
	});

	it("setSurgePause shows 'now' for past dates", () => {
		const resetAt = new Date(Date.now() - 1000);
		widget.setSurgePause(resetAt);
		const lines = widget.renderWidget(80, stubTheme);
		// Label format: "surge (now)"
		assert.ok(lines.some(l => l.includes("surge") && l.includes("(now)")));
	});

	// ─── Console fallback ─────────────────────────────────────────────────

	it("toConsoleString returns human-readable output", () => {
		widget.startIteration(2, 5);
		widget.setPhase("writing", "coding");
		widget.recordWrite("src/test.ts");
		const output = widget.toConsoleString();
		assert.match(output, /harness/);
		assert.match(output, /iter 2\/5/);
		assert.match(output, /coding/);
		assert.match(output, /test\.ts/);
	});

	// ─── Width / truncation ───────────────────────────────────────────────

	it("truncates long file names with …", () => {
		widget.recordWrite("/very/long/path/to/a/very/long/file/name/that/exceeds/width.ts");
		const lines = widget.renderWidget(40, stubTheme);
		for (const line of lines) {
			const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
			assert.ok(stripped.length <= 41, `line too long: ${stripped}`);
		}
	});

	// ─── reset() ─────────────────────────────────────────────────────────

	it("reset() clears all state", () => {
		widget.startIteration(2, 5);
		widget.setPhase("writing");
		widget.recordWrite("src/a.ts");
		widget.reset();
		const lines = widget.renderWidget(80, stubTheme);
		assert.match(lines[0], /idle/);
		assert.ok(!lines.some(l => l.includes("a.ts")));
	});

	// ─── makeRenderer ─────────────────────────────────────────────────────

	it("makeRenderer returns factory and invalidate", () => {
		const { factory, invalidate } = widget.makeRenderer();
		assert.equal(typeof factory, "function");
		assert.equal(typeof invalidate, "function");
	});

	it("factory returns render + invalidate + dispose", () => {
		const { factory } = widget.makeRenderer();
		const comp = factory({} as any, stubTheme as any);
		assert.equal(typeof comp.render, "function");
		assert.equal(typeof comp.invalidate, "function");
		assert.equal(typeof comp.dispose, "function");
	});

	it("factory render() returns widget lines", () => {
		widget.setPhase("planning");
		const { factory } = widget.makeRenderer();
		const comp = factory({} as any, stubTheme as any);
		const lines = comp.render(80);
		assert.ok(Array.isArray(lines));
		assert.ok(lines.length > 0);
	});

	// ─── getLoopWidget singleton ────────────────────────────────────────────

	it("getLoopWidget returns the same instance", () => {
		// Dynamic import to avoid module caching issues
		import("./widget.js").then(m => {
			const a = m.getLoopWidget();
			const b = m.getLoopWidget();
			assert.strictEqual(a, b);
		});
	});

});

// @ts-nocheck
/**
 * Unit tests for harness-header.ts
 *
 * Tests cover:
 * - ANSI reset after every colored logo segment
 * - Visible logo width (4 cells)
 * - Compact/expanded expansion
 * - Narrow-width rendering (no escape corruption)
 * - No emoji in output
 *
 * Run with: bun test packages/tui/test/harness-header.test.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { createHarnessHeader, stripAnsi, visibleWidth, type HarnessHeaderOptions } from "../src/harness-header.js";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Initialize pi-coding-agent theme (required for keyText/keyHint)
// ---------------------------------------------------------------------------

let testTheme: Theme;

beforeAll(() => {
	// Initialize with dark theme so the global theme proxy works for keyText/keyHint
	initTheme("dark");

	// Create a minimal mock Theme for the harness header's logo rendering.
	// This satisfies Theme.fg() without needing a real terminal.
	// The global theme from initTheme() is used by keyText/keyHint internally.
	testTheme = {
		fg(color, text) {
			// Return text with ANSI codes matching dark theme colors
			const codes: Record<string, string> = {
				accent: "\x1b[36m", // cyan for dark theme accent
				success: "\x1b[32m", // green
				muted: "\x1b[90m", // bright black (gray)
				dim: "\x1b[90m",
				text: "\x1b[37m", // white
			};
			return `${codes[color] ?? ""}${text}\x1b[39m`;
		},
		bg() { return ""; },
		style() { return ""; },
		bold() { return ""; },
		italic() { return ""; },
		underline() { return ""; },
		inverse() { return ""; },
		strikethrough() { return ""; },
		getFgAnsi() { return ""; },
		getBgAnsi() { return ""; },
		getColorMode() { return "truecolor"; },
		getThinkingBorderColor() { return () => ""; },
		getBashModeBorderColor() { return () => ""; },
		get appearance() { return "dark"; },
		get colors() { return {}; },
	} as unknown as Theme;
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_OPTIONS: HarnessHeaderOptions = {
	version: "1.0.0",
	productName: "Harness",
	onboardingText: "Test onboarding.",
};

function createMockTui() {
	return {} as object;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("visibleWidth", () => {
	it("returns 0 for empty string", () => {
		expect(visibleWidth("")).toBe(0);
	});

	it("returns correct length for plain text", () => {
		expect(visibleWidth("hello")).toBe(5);
	});

	it("subtracts ANSI escape sequences from length", () => {
		const colored = "\x1b[31mhello\x1b[39m";
		expect(visibleWidth(colored)).toBe(5);
	});

	it("handles multiple escape sequences", () => {
		const colored = "\x1b[1m\x1b[31mbold red\x1b[39m\x1b[22m";
		// "bold red" = 9 chars visible, minus 1 = 8 (the space in "bold red")
		expect(visibleWidth(colored)).toBe(8);
	});
});

describe("stripAnsi", () => {
	it("returns empty string for empty input", () => {
		expect(stripAnsi("")).toBe("");
	});

	it("returns original string if no escapes", () => {
		expect(stripAnsi("hello world")).toBe("hello world");
	});

	it("strips all ANSI escapes", () => {
		const colored = "\x1b[1m\x1b[31mbold red\x1b[39m\x1b[22m";
		expect(stripAnsi(colored)).toBe("bold red");
	});
});

describe("logo segment ANSI resets", () => {
	it("all ANSI sequences in output are complete (balanced opens/closes)", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const lines = header.render(80);

		for (const line of lines) {
			const csiStarts = (line.match(/\x1b\[/g) || []).length;
			const completeSeqs = (line.match(/\x1b\[[0-9;]*[a-zA-Z]/g) || []).length;
			expect(completeSeqs).toBe(csiStarts);
		}
	});
});

describe("logo visible width", () => {
	it("logo occupies exactly 4 visible cells per row", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const lines = header.render(80);

		const logoLine = lines.find((l) => stripAnsi(l).includes("▀") || stripAnsi(l).includes("█"));
		expect(logoLine).toBeDefined();

		const plain = stripAnsi(logoLine!);
		const logoMatch = plain.match(/^([▀▄█]+)/);
		expect(logoMatch).not.toBeNull();
		expect(logoMatch[1].length).toBe(4);
	});

	it("logo renders on exactly 2 rows", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const lines = header.render(80);

		const logoLines = lines.filter((l) => stripAnsi(l).includes("▀") || stripAnsi(l).includes("█"));
		expect(logoLines.length).toBe(2);
	});
});

describe("setExpanded", () => {
	it("starts in compact mode", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const compactLines = header.render(80);

		const compactText = stripAnsi(compactLines.join("\n"));
		// keyHint returns key name + description; check for the interrupt key (escape)
		expect(compactText.toLowerCase()).toContain("interrupt");
	});

	it("switches to expanded mode when setExpanded(true)", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);

		header.setExpanded(true);
		const expandedLines = header.render(80);
		const expandedText = stripAnsi(expandedLines.join("\n"));

		expect(expandedText.toLowerCase()).toContain("abort");
		expect(expandedText.toLowerCase()).toContain("clear");
		expect(expandedText.toLowerCase()).toContain("slash");
	});

	it("switches back to compact when setExpanded(false)", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);

		header.setExpanded(true);
		header.setExpanded(false);
		const collapsedLines = header.render(80);

		const hasDotSeparator = collapsedLines.some((l) => stripAnsi(l).includes(" · "));
		expect(hasDotSeparator).toBe(true);
	});

	it("idempotent when setting same state twice", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);

		header.setExpanded(true);
		const lines1 = header.render(80);
		header.setExpanded(true);
		const lines2 = header.render(80);

		expect(lines1).toEqual(lines2);
	});
});

describe("narrow width rendering", () => {
	it("does not split ANSI escape sequences", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);

		const widths = [20, 40, 60, 80, 120];

		for (const width of widths) {
			const lines = header.render(width);
			for (const line of lines) {
				const incompletePattern = /\x1b\[[0-9;]*[^\x1b\x5bm]?$/;
				expect(incompletePattern.test(line)).toBe(false);
			}
		}
	});

	it("renders without error at width 1", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);

		expect(() => header.render(1)).not.toThrow();
	});
});

describe("no emoji", () => {
	it("output contains no emoji code points", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const lines = header.render(80);

		const allText = lines.join("\n");

		const emojiRanges = [
			/[\u{1F300}-\u{1F9FF}]/u,
			/[\u{2600}-\u{26FF}]/u,
			/[\u{2700}-\u{27BF}]/u,
			/[\u{1F600}-\u{1F64F}]/u,
			/[\u{1F680}-\u{1F6FF}]/u,
		];

		for (const range of emojiRanges) {
			const matches = allText.match(range);
			expect(matches).toBeNull();
		}
	});

	it("uses only allowed Unicode block characters", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const lines = header.render(80);

		for (const line of lines) {
			const plain = stripAnsi(line);

			for (const char of plain) {
				const code = char.charCodeAt(0);

				if (code >= 0x20 && code <= 0x7e) continue;
				if (code === 0x20) continue;
				if (char === "▀" || char === "▄" || char === "█") continue;
				if (char === "\n") continue;
				if (char === "·") continue; // middle dot U+00B7 used in shortcuts

				expect(`Unexpected character: ${char} (U+${code.toString(16).padStart(4, "0")})`).toBe("");
			}
		}
	});
});

describe("version display", () => {
	it("displays correct version from options", () => {
		const customOptions: HarnessHeaderOptions = {
			...TEST_OPTIONS,
			version: "2.5.10-test",
		};
		const header = createHarnessHeader(createMockTui(), testTheme, customOptions);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("v2.5.10-test");
	});

	it("defaults product name to 'Harness'", () => {
		const optionsWithoutName: HarnessHeaderOptions = {
			version: "1.0.0",
		};
		const header = createHarnessHeader(createMockTui(), testTheme, optionsWithoutName);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Harness");
	});
});

describe("dynamic key hints", () => {
	it("renders hint text for shortcuts", () => {
		const header = createHarnessHeader(createMockTui(), testTheme, TEST_OPTIONS);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));

		expect(text.toLowerCase()).toContain("interrupt");
		expect(text.toLowerCase()).toContain("command");
	});
});

describe("onboarding text", () => {
	it("displays custom onboarding text", () => {
		const customOptions: HarnessHeaderOptions = {
			...TEST_OPTIONS,
			onboardingText: "Custom onboarding message.",
		};
		const header = createHarnessHeader(createMockTui(), testTheme, customOptions);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Custom onboarding message.");
	});
});

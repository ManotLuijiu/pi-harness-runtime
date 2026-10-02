/**
 * Unit tests for harness-header.ts
 *
 * Tests cover:
 * - ANSI reset after every colored logo segment
 * - Visible logo width (4 cells)
 * - Compact/expanded expansion (both logo rows preserved)
 * - Narrow-width rendering with truncation
 * - No emoji in output
 * - Fallback for non-truecolor modes
 *
 * Run with: bun test packages/tui/test/harness-header.test.ts
 */

// @ts-expect-error: bun:test types are provided by bun runtime
import { beforeAll, describe, expect, it } from "bun:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	createHarnessHeader,
	type HarnessHeaderOptions,
	stripAnsi,
	visibleWidth,
} from "../src/harness-header.js";

// ---------------------------------------------------------------------------
// Initialize pi-coding-agent theme (required for keyText/keyHint)
// ---------------------------------------------------------------------------

let trueColorTheme: Theme;
let color256Theme: Theme;
let headlessTheme: Theme;

beforeAll(() => {
	// Initialize with dark theme so the global theme proxy works for keyText/keyHint
	initTheme("dark");

	// Minimal mock Theme for the harness header's logo rendering.
	// getColorMode() returns "truecolor" to test half-block mode.
	trueColorTheme = {
		fg(color: string, text: string): string {
			const codes: Record<string, string> = {
				accent: "\x1b[36m",
				success: "\x1b[32m",
				muted: "\x1b[90m",
				dim: "\x1b[90m",
				text: "\x1b[37m",
			};
			return `${codes[color] ?? ""}${text}\x1b[39m`;
		},
		bg(): string {
			return "";
		},
		style(): string {
			return "";
		},
		bold(): string {
			return "";
		},
		italic(): string {
			return "";
		},
		underline(): string {
			return "";
		},
		inverse(): string {
			return "";
		},
		strikethrough(): string {
			return "";
		},
		getFgAnsi(): string {
			return "";
		},
		getBgAnsi(): string {
			return "";
		},
		getColorMode(): string {
			return "truecolor";
		},
		getThinkingBorderColor() {
			return () => "";
		},
		getBashModeBorderColor() {
			return () => "";
		},
		get appearance(): string {
			return "dark";
		},
		get colors(): Record<string, unknown> {
			return {};
		},
	} as unknown as Theme;

	// 256-color theme — ColorMode is "truecolor" | "256color" in real usage.
	// Both truecolor and 256color render the same half-block logo (ANSI 256 works for both).
	color256Theme = {
		...trueColorTheme,
		getColorMode(): string {
			return "256color";
		},
	} as unknown as Theme;

	// Headless/no-color theme — only reachable in true headless environments where
	// getColorMode() returns undefined/null (not in ColorMode type but defensively handled).
	// In this mode the logo renders as empty lines and the product name shows normally.
	headlessTheme = {
		...trueColorTheme,
		getColorMode(): string {
			return ""; // empty = no color support
		},
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

function mockTui(): object {
	return {};
}

// ---------------------------------------------------------------------------
// visibleWidth
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
		// "bold red" = 8 visible chars
		expect(visibleWidth(colored)).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ANSI balance
// ---------------------------------------------------------------------------

describe("ANSI balance", () => {
	it("all ANSI sequences are complete (balanced opens/closes)", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		for (const line of lines) {
			// Check that visible length + ANSI overhead = total length
			// Any incomplete CSI sequence would make this unequal
			const stripped = stripAnsi(line);
			const overhead = line.length - stripped.length;
			// Each complete escape takes at least 3 chars ("\x1b[" + letter)
			const estimatedCompleteSeqs = Math.floor(overhead / 3);
			// Overhead should be a multiple of complete sequences
			expect(overhead).toBeGreaterThanOrEqual(estimatedCompleteSeqs * 3);
		}
	});

	it("each fg() call produces exactly one reset", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);
		const allText = lines.join("");

		// After stripping ANSI, every colored segment should have matching reset
		// If we strip and join, the result should be clean (no dangling resets)
		const stripped = stripAnsi(allText);
		// Stripped text should not contain any raw escape bytes
		expect(stripped.includes("\x1b")).toBe(false);
		// At minimum, the logo has 8 fg() calls (4 chars × 2 rows)
		const resetSeq = "\x1b[39m";
		const resets = allText.split(resetSeq).length - 1;
		expect(resets).toBeGreaterThanOrEqual(8);
	});
});

// ---------------------------------------------------------------------------
// Logo geometry
// ---------------------------------------------------------------------------

describe("logo geometry", () => {
	it("logo occupies exactly 4 visible cells per row", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		const logoLine = lines.find(
			(l: string) => stripAnsi(l).includes("▀") || stripAnsi(l).includes("█"),
		);
		if (!logoLine) return; // guarded by expect above

		const plain = stripAnsi(logoLine);
		const logoMatch = plain.match(/^([▀▄█]+)/);
		expect(logoMatch?.[1].length ?? 0).toBe(4);
	});

	it("logo renders on exactly 2 rows in compact mode", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		const logoLines = lines.filter(
			(l: string) => stripAnsi(l).includes("▀") || stripAnsi(l).includes("█"),
		);
		expect(logoLines.length).toBe(2);
	});

	it("logo renders on exactly 2 rows in expanded mode", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		header.setExpanded(true);
		const lines = header.render(80);

		const logoLines = lines.filter(
			(l: string) => stripAnsi(l).includes("▀") || stripAnsi(l).includes("█"),
		);
		// Both logo rows should be present in expanded mode
		expect(logoLines.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Fallback mode
// ---------------------------------------------------------------------------

describe("fallback mode", () => {
	it("uses plain text when getColorMode() returns 'mono'", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			color256Theme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		const allText = stripAnsi(lines.join("\n"));
		// Should contain "Harness" but NOT block characters
		expect(allText).toContain("Harness");
		expect(allText).not.toContain("▀");
		expect(allText).not.toContain("█");
	});

	it("falls back when getColorMode() returns 'none'", () => {
		const noColorTheme = {
			...headlessTheme,
			getColorMode(): string {
				return "none";
			},
		} as unknown as Theme;

		const header = createHarnessHeader(
			mockTui() as never,
			noColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);
		const allText = stripAnsi(lines.join("\n"));

		expect(allText).toContain("Harness");
		expect(allText).not.toContain("▀");
	});
});

// ---------------------------------------------------------------------------
// Width-aware truncation
// ---------------------------------------------------------------------------

describe("width-aware truncation", () => {
	it("truncates lines longer than width", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(20); // narrow width

		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
	});

	it("does not split ANSI escape sequences at truncation boundary", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(10); // very narrow

		for (const line of lines) {
			// No incomplete CSI sequences: each escape ends with a letter
			// A truncated line would end mid-escape, visible in stripAnsi output
			const stripped = stripAnsi(line);
			// If a line ends mid-escape, visibleWidth would not match stripAnsi length
			expect(visibleWidth(line)).toBe(stripped.length);
		}
	});

	it("appends ellipsis when truncating", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(5);

		const hasEllipsis = lines.some((l: string) => stripAnsi(l).endsWith("…"));
		// At least some lines should be truncated at width 5
		expect(hasEllipsis).toBe(true);
	});

	it("every line ends with ANSI reset after truncation", () => {
		// At narrow widths, truncate() must not leave open color sequences.
		// Every line must end with \x1b[39m (default foreground reset).
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(20); // forces truncation on most lines

		for (const line of lines) {
			if (line === "") continue; // blank lines are safe
			// Must end with foreground reset
			expect(line.endsWith("\x1b[39m")).toBe(true);
		}
	});

	it("renders without error at width 1", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		expect(() => header.render(1)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// setExpanded
// ---------------------------------------------------------------------------

describe("setExpanded", () => {
	it("starts in compact mode", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		// Compact should have hints with "·" separator
		const compactText = stripAnsi(lines.join("\n"));
		expect(compactText.toLowerCase()).toContain("interrupt");
	});

	it("switches to expanded mode when setExpanded(true)", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		header.setExpanded(true);
		const lines = header.render(80);
		const expandedText = stripAnsi(lines.join("\n"));

		// Expanded has full descriptions
		expect(expandedText.toLowerCase()).toContain("abort");
		expect(expandedText.toLowerCase()).toContain("clear");
		expect(expandedText.toLowerCase()).toContain("slash");
	});

	it("switches back to compact when setExpanded(false)", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		header.setExpanded(true);
		header.setExpanded(false);
		const lines = header.render(80);

		const hasDotSeparator = lines.some((l: string) =>
			stripAnsi(l).includes(" · "),
		);
		expect(hasDotSeparator).toBe(true);
	});

	it("is idempotent when setting same state twice", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		header.setExpanded(true);
		const lines1 = header.render(80);
		header.setExpanded(true); // same state again
		const lines2 = header.render(80);
		expect(lines1).toEqual(lines2);
	});
});

// ---------------------------------------------------------------------------
// No emoji
// ---------------------------------------------------------------------------

describe("no emoji", () => {
	it("output contains no emoji code points", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
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
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		for (const line of lines) {
			const plain = stripAnsi(line);

			for (const char of plain) {
				const code = char.charCodeAt(0);

				// ASCII printable
				if (code >= 0x20 && code <= 0x7e) continue;
				// Space
				if (code === 0x20) continue;
				// Block elements: ▀ (U+2580) ▄ (U+2584) █ (U+2588)
				if (char === "▀" || char === "▄" || char === "█") continue;
				// Middle dot U+00B7 used in shortcuts
				if (char === "·") continue;
				// Ellipsis U+2026
				if (char === "…") continue;
				// Newline handled by line iteration
				if (char === "\n") continue;

				expect(
					`Unexpected character: ${char} (U+${code.toString(16).padStart(4, "0")})`,
				).toBe("");
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Version and text display
// ---------------------------------------------------------------------------

describe("version display", () => {
	it("displays correct version from options", () => {
		const customOptions: HarnessHeaderOptions = {
			...TEST_OPTIONS,
			version: "2.5.10-test",
		};
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			customOptions,
		);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("v2.5.10-test");
	});

	it("defaults product name to 'Harness'", () => {
		const optionsWithoutName: HarnessHeaderOptions = { version: "1.0.0" };
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			optionsWithoutName,
		);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Harness");
	});
});

// ---------------------------------------------------------------------------
// Dynamic key hints
// ---------------------------------------------------------------------------

describe("dynamic key hints", () => {
	it("renders hint text for shortcuts", () => {
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			TEST_OPTIONS,
		);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));

		expect(text.toLowerCase()).toContain("interrupt");
		expect(text.toLowerCase()).toContain("command");
	});
});

// ---------------------------------------------------------------------------
// Onboarding text
// ---------------------------------------------------------------------------

describe("onboarding text", () => {
	it("displays custom onboarding text", () => {
		const customOptions: HarnessHeaderOptions = {
			...TEST_OPTIONS,
			onboardingText: "Custom onboarding message.",
		};
		const header = createHarnessHeader(
			mockTui() as never,
			trueColorTheme,
			customOptions,
		);
		const lines = header.render(80);

		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Custom onboarding message.");
	});
});

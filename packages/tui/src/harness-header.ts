/**
 * Harness ASCII Banner — a Pi-compatible custom header using Unicode half-block art.
 *
 * Uses the same half-block rendering technique as Pi's built-in header:
 * - `▀` (U+2580) fills the upper half of a terminal cell
 * - `▄` (U+2584) fills the lower half of a terminal cell
 * - Foreground + background color creates two "pixels" per cell
 *
 * Logo: 4 cells wide × 2 rows. Pattern is Harness-branded (accent + success colors).
 * Compact/expanded states respond to Ctrl+O via Pi's global setExpanded() mechanism.
 *
 * MIT — derived from general technique documented in upstream pi-coding-agent.
 * Harness branding is original work of the harness project.
 */

import type { Component, TUI } from "@earendil-works/pi-tui";

// Re-export Theme from pi-coding-agent since @pi-harness/tui has no theme dependency.
// Extensions already depend on @earendil-works/pi-coding-agent.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyText, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Logo design
// ---------------------------------------------------------------------------
//
// Logical 4×4 pixel grid (each cell = foreground+background color pair):
//
//   Row 0: ░ ░ ▓ ▒  (top half-blocks: accent, accent, dim, dim)
//   Row 1: ▓ ░ ░ ▒  (bottom half-blocks: dim, success, success, dim)
//
// Rendered as 2 text rows with 4 terminal cells per row:
//   Line 0: ▀▀█▄  (▀ = upper-half, █ = full-block, ▄ = lower-half)
//   Line 1: █▀▀▄  (same characters, different color pairing)
//
// Colors:
//   - accent   = harness primary (teal in harness theme, adapts to user's theme)
//   - success  = harness secondary (green in harness theme)
//   - muted    = dim teal (for visual depth)
//   - dim      = dim blue (for visual depth)
//
// The logo is NOT Pi's logo — it uses the same rendering technique only.

// Logo glyphs documented in logoLines() for reference.

/** Harness primary color — uses theme "accent" (teal in harness theme) */
function logoAccent(text: string, theme: Theme): string {
	return theme.fg("accent", text);
}

/** Harness secondary color — uses theme "success" (green in harness theme) */
function logoSecondary(text: string, theme: Theme): string {
	return theme.fg("success", text);
}

/** Dim foreground — uses theme "muted" for depth */
function logoDim(text: string, theme: Theme): string {
	return theme.fg("muted", text);
}

/**
 * Build the two colored logo lines for the Harness mark.
 *
 * Color segment per cell (each char = one terminal cell):
 *   Line 0:  ▀▀█▄   →  ▀(accent) ▀(accent) █(muted) ▄(muted)
 *   Line 1:  █▀▀▄   →  █(muted) ▀(success) ▀(success) ▄(muted)
 */
function logoLines(theme: Theme): [string, string] {
	return [
		logoAccent("▀", theme) +
		logoAccent("▀", theme) +
		logoDim("█", theme) +
		logoDim("▄", theme),
		logoDim("█", theme) +
		logoSecondary("▀", theme) +
		logoSecondary("▀", theme) +
		logoDim("▄", theme),
	];
}

// ---------------------------------------------------------------------------
// Fallback (Apple Terminal, no half-block support, or print/RPC modes)
// ---------------------------------------------------------------------------

const FALLBACK_LOGO_LINE0 = "Harness";
const FALLBACK_LOGO_LINE1 = "";

// ---------------------------------------------------------------------------
// HarnessHeader component
// ---------------------------------------------------------------------------

export interface HarnessHeaderOptions {
	version: string;
	productName?: string;
	onboardingText?: string;
}

export function createHarnessHeader(
	_tui: TUI,
	_theme: Theme,
	options: HarnessHeaderOptions,
): HarnessHeaderComponent {
	return new HarnessHeaderComponent(_theme, options);
}

class HarnessHeaderComponent implements Component {
	private readonly theme: Theme;
	private readonly options: Required<HarnessHeaderOptions>;
	private expanded = false;
	private supportsHalfBlocks = true;

	constructor(theme: Theme, options: HarnessHeaderOptions) {
		this.theme = theme;
		this.options = {
			productName: "Harness",
			onboardingText:
				"Harness extends Pi with quota management, automation, memory, and multi-agent workflows.",
			...options,
		};
	}

	// --- Component interface ---

	render(_width: number): string[] {
		const { version, onboardingText } = this.options;

		// Logo: half-block art or plain fallback
		const [logoLine0, logoLine1] = this.supportsHalfBlocks
			? logoLines(this.theme)
			: [FALLBACK_LOGO_LINE0, FALLBACK_LOGO_LINE1];

		const versionStr = this.theme.fg("dim", `v${version}`);
		const expandKey = keyText("app.tools.expand");
		const onboarding = this.theme.fg("dim", onboardingText);

		if (this.expanded) {
			return this.renderExpanded(logoLine0, versionStr, expandKey, onboarding);
		}
		return this.renderCompact(logoLine0, logoLine1, versionStr, expandKey, onboarding);
	}

	private renderCompact(
		logoLine0: string,
		logoLine1: string,
		versionStr: string,
		expandKey: string,
		onboarding: string,
	): string[] {
		const { productName } = this.options;

		// Build compact one-line shortcuts
		const hints = [
			keyHint("app.interrupt", "interrupt"),
			rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
			rawKeyHint("/", "commands"),
			rawKeyHint("!", "bash"),
			keyHint("app.tools.expand", "more"),
		].join(this.theme.fg("muted", " · "));

		// Line 0: logo + product name + version
		const line0 = `${logoLine0}  ${this.theme.fg("text", productName)} ${versionStr}`;

		// Line 1: bottom logo row + compact hints
		const line1 = `${logoLine1}  ${hints}`;

		// Line 2: expand prompt
		const line2 = this.theme.fg(
			"dim",
			`Press ${expandKey} to show full startup help and loaded resources.`,
		);

		// Line 4 (blank line 3): onboarding
		const line4 = onboarding;

		return ["", line0, line1, line2, "", line4, ""];
	}

	private renderExpanded(
		logoLine0: string,
		versionStr: string,
		expandKey: string,
		onboarding: string,
	): string[] {
		const { productName } = this.options;

		// Line 0: logo + product name + version
		const line0 = `${logoLine0}  ${this.theme.fg("text", productName)} ${versionStr}`;

		// Expanded: one shortcut per line
		const expandedLines = [
			keyHint("app.interrupt", "abort the current agent turn"),
			keyHint("app.clear", "clear the current session"),
			keyHint("app.exit", "exit Pi"),
			rawKeyHint("/", "show available slash commands"),
			rawKeyHint("!", "open a bash shell"),
			keyHint("app.tools.expand", "expand/collapse tool output and this header"),
			this.theme.fg("muted", `${expandKey} to collapse`),
		];

		// Line 2: expand prompt
		const line2 = this.theme.fg("dim", `Press ${expandKey} to show compact header.`);

		// Line 4: onboarding
		const line4 = onboarding;

		// Compose: blank, logo, blank, expanded hints (indented), blank, expand prompt, blank, onboarding, blank
		const result: string[] = [""];
		result.push(line0);
		result.push(""); // blank after logo
		for (const hint of expandedLines) {
			result.push(`  ${hint}`);
		}
		result.push("");
		result.push(line2);
		result.push("");
		result.push(line4);
		result.push("");

		return result;
	}

	invalidate(): void {
		// Theme changes or expansion state changes call this to request re-render.
		// The TUI calls render() again automatically.
	}

	// --- Expandable interface (called by Pi when Ctrl+O toggles) ---

	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.invalidate();
	}

	// --- Cleanup ---

	dispose(): void {
		// No persistent resources to clean up.
	}
}

// ---------------------------------------------------------------------------
// Visible width helper (ANSI-aware)
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences to get visible character count. */
export function visibleWidth(str: string): number {
	// Remove all ANSI CSI sequences: \x1b[...X
	return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

/** Strip ANSI to get plain text for width/equality checks. */
export function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

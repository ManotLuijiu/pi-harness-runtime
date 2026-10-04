/**
 * Harness ASCII Banner — a Pi-compatible custom header.
 *
 * Uses Unicode block characters to create a compact 4×2 logo:
 * - `▀` (U+2580) fills the upper half of a terminal cell
 * - `▄` (U+2584) fills the lower half of a terminal cell
 * - Each cell uses a distinct foreground color to suggest depth
 *
 * The logo is NOT Pi's logo — it uses the same rendering primitives only.
 */
import { keyHint, keyText, rawKeyHint } from "@earendil-works/pi-coding-agent";
// ---------------------------------------------------------------------------
// Logo design
// ---------------------------------------------------------------------------
//
// Logical 4×4 pixel grid (each cell = one foreground color):
//
//   Row 0: ░ ░ ▓ ▒  (top half-blocks: accent, accent, muted, muted)
//   Row 1: ▓ ░ ░ ▒  (bottom half-blocks: muted, success, success, muted)
//
// Rendered as 2 text rows with 4 terminal cells per row:
//   Line 0: ▀▀█▄  (▀ = upper-half block, █ = full block, ▄ = lower-half block)
//   Line 1: █▀▀▄  (alternating foreground colors per cell)
//
// Colors:
//   - accent   = harness primary (teal in harness theme, adapts to user's theme)
//   - success  = harness secondary (green in harness theme)
//   - muted    = dim teal (for visual depth)
//
// The fallback for non-color/headless modes uses an empty logo; renderCompact/Expanded
// show the product name and version normally.
// Logo glyphs defined inline in logoLines() — kept here for reference only.
/** Harness primary — accent color from active theme */
function logoAccent(text, theme) {
    return theme.fg("accent", text);
}
/** Harness secondary — success color from active theme */
function logoSuccess(text, theme) {
    return theme.fg("success", text);
}
/** Dim foreground — muted color for visual depth */
function logoDim(text, theme) {
    return theme.fg("muted", text);
}
/**
 * Build the two colored logo lines for the Harness mark.
 *
 * Each character has its own foreground color:
 *   Line 0:  ▀▀█▄   →  ▀(accent) ▀(accent) █(muted) ▄(muted)
 *   Line 1:  █▀▀▄   →  █(muted) ▀(success) ▀(success) ▄(muted)
 */
function logoLines(theme) {
    return [
        logoAccent("▀", theme) +
            logoAccent("▀", theme) +
            logoDim("█", theme) +
            logoDim("▄", theme),
        logoDim("█", theme) +
            logoSuccess("▀", theme) +
            logoSuccess("▀", theme) +
            logoDim("▄", theme),
    ];
}
// ---------------------------------------------------------------------------
// Fallback (Apple Terminal, no true-color, or non-TUI modes)
// ---------------------------------------------------------------------------
const FALLBACK_LINE0 = "";
const FALLBACK_LINE1 = "";
export function createHarnessHeader(_tui, theme, options) {
    return new HarnessHeaderComponent(theme, options);
}
class HarnessHeaderComponent {
    theme;
    options;
    expanded = false;
    constructor(theme, options) {
        this.theme = theme;
        this.options = {
            productName: "Harness",
            onboardingText: "Harness extends Pi with quota management, automation, memory, and multi-agent workflows.",
            ...options,
        };
    }
    // --- Component interface ---
    render(width) {
        const { version, onboardingText } = this.options;
        // Detect true-color support to enable/disable half-block rendering.
        // Falls back to plain text when color mode is unavailable or mono.
        const supportsHalfBlocks = this.theme.getColorMode() === "truecolor";
        const [logoLine0, logoLine1] = supportsHalfBlocks
            ? logoLines(this.theme)
            : [FALLBACK_LINE0, FALLBACK_LINE1];
        const versionStr = this.theme.fg("dim", `v${version}`);
        const expandKey = keyText("app.tools.expand");
        const onboarding = this.theme.fg("dim", onboardingText);
        if (this.expanded) {
            return this.renderExpanded(width, logoLine0, logoLine1, versionStr, expandKey, onboarding);
        }
        return this.renderCompact(width, logoLine0, logoLine1, versionStr, expandKey, onboarding);
    }
    renderCompact(width, logoLine0, logoLine1, versionStr, expandKey, onboarding) {
        const { productName } = this.options;
        // Build compact one-line shortcuts
        const hints = [
            keyHint("app.interrupt", "interrupt"),
            rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
            rawKeyHint("/", "commands"),
            rawKeyHint("!", "bash"),
            keyHint("app.tools.expand", "more"),
        ].join(this.theme.fg("muted", " · "));
        // Build each line and truncate to width
        const line0 = this.truncate(`${logoLine0}  ${this.theme.fg("text", productName)} ${versionStr}`, width);
        const line1 = this.truncate(`${logoLine1}  ${hints}`, width);
        const line2 = this.truncate(this.theme.fg("dim", `Press ${expandKey} to show full startup help and loaded resources.`), width);
        const line4 = this.truncate(onboarding, width);
        return ["", line0, line1, line2, "", line4, ""];
    }
    renderExpanded(width, logoLine0, logoLine1, versionStr, expandKey, onboarding) {
        const { productName } = this.options;
        // Build lines — both logo rows are preserved
        const line0 = this.truncate(`${logoLine0}  ${this.theme.fg("text", productName)} ${versionStr}`, width);
        const line1 = this.truncate(`${logoLine1}  `, width);
        const line3 = this.truncate(this.theme.fg("dim", `Press ${expandKey} to show compact header.`), width);
        const line5 = this.truncate(onboarding, width);
        // Expanded: one shortcut per line
        const expandedHints = [
            keyHint("app.interrupt", "abort the current agent turn"),
            keyHint("app.clear", "clear the current session"),
            keyHint("app.exit", "exit Pi"),
            rawKeyHint("/", "show available slash commands"),
            rawKeyHint("!", "open a bash shell"),
            keyHint("app.tools.expand", "expand/collapse tool output and this header"),
            this.theme.fg("muted", `${expandKey} to collapse`),
        ];
        // Compose: blank, logo row 1, logo row 2, blank, hints (indented), blank, expand prompt, blank, onboarding, blank
        const result = [""];
        result.push(line0);
        result.push(line1);
        result.push(""); // blank after logo
        for (const hint of expandedHints) {
            result.push(this.truncate(`  ${hint}`, width));
        }
        result.push("");
        result.push(line3);
        result.push("");
        result.push(line5);
        result.push("");
        return result;
    }
    /**
     * Truncate a string to at most `maxWidth` visible characters.
     * ANSI escape sequences are excluded from the width count and preserved in the output.
     * If truncation occurs, a "…" (U+2026) is appended.
     */
    truncate(str, maxWidth) {
        if (maxWidth <= 0)
            return "";
        const w = visibleWidth(str);
        if (w <= maxWidth)
            return str;
        // Collect characters up to maxWidth and append ellipsis
        const ellipsis = "…";
        const ellipsisWidth = visibleWidth(ellipsis);
        const targetWidth = Math.max(1, maxWidth - ellipsisWidth);
        let currentWidth = 0;
        let inEscape = false;
        let escapeBuffer = "";
        const result = [];
        for (const char of str) {
            if (char === "\x1b") {
                inEscape = true;
                escapeBuffer = char;
                continue;
            }
            if (inEscape) {
                escapeBuffer += char;
                if (/[a-zA-Z]/.test(char)) {
                    // End of CSI sequence
                    result.push(escapeBuffer);
                    inEscape = false;
                    escapeBuffer = "";
                }
                continue;
            }
            // Visible character
            const charWidth = visibleWidth(char);
            if (currentWidth + charWidth > targetWidth) {
                break;
            }
            currentWidth += charWidth;
            result.push(char);
        }
        // Always append a foreground reset so any open color is closed.
        // If we broke out mid-escape, the partial escape buffer is discarded
        // (it would be an incomplete sequence). The reset restores default.
        return `${result.join("")}${ellipsis}\x1b[39m`;
    }
    invalidate() {
        // Theme changes or expansion state changes call this to request re-render.
        // The TUI calls render() again automatically.
    }
    // --- Expandable interface (called by Pi when Ctrl+O toggles) ---
    setExpanded(expanded) {
        if (this.expanded === expanded)
            return;
        this.expanded = expanded;
        this.invalidate();
    }
    // --- Cleanup ---
    dispose() {
        // No persistent resources to clean up.
    }
}
// ---------------------------------------------------------------------------
// Visible width helpers (ANSI-aware)
// ---------------------------------------------------------------------------
/**
 * Compute the visible character count of a string, excluding ANSI escape sequences.
 * Uses `new RegExp()` to avoid Biome's no-control-characters-in-regex rule.
 */
export function visibleWidth(str) {
    // biome-ignore lint/complexity/useRegexLiterals: must use string constructor to avoid control-char-in-regex error
    return str.replace(new RegExp("\x1b\\[[0-9;]*[a-zA-Z]", "g"), "").length;
}
/** Strip all ANSI escape sequences from a string. */
export function stripAnsi(str) {
    // biome-ignore lint/complexity/useRegexLiterals: must use string constructor to avoid control-char-in-regex error
    return str.replace(new RegExp("\x1b\\[[0-9;]*[a-zA-Z]", "g"), "");
}
//# sourceMappingURL=harness-header.js.map
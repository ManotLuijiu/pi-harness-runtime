/**
 * Format detection — does the input look like Netscape, a space-separated
 * Netscape export, or EditThisCookie JSON?
 *
 * Detection rule:
 *  - First non-blank byte is `[` or `{`                          →  JSON
 *  - ≥ 1 tab-separated 7-column row                             →  Netscape
 *  - ≥ 1 row that the compatible parser accepts                →  Netscape (space)
 *  - Otherwise                                                  →  unknown
 *
 * The header wording is not part of the rule: an export whose header
 * differs from the canonical wording is still a supported format when its
 * rows are readable.
 *
 * SEC-001: cookie values are never copied into a return value that gets
 * logged. A diagnostic carries counts and reason codes only — never a
 * line, a header, a cookie name, or a cookie value.
 */
import type { CookieFileFormat, DetectedFile } from "./types.js";
/** Why a file was not recognized. A reason code, never its content. */
export type FormatRejection = "empty" | "no-rows" | "space-rows-not-valid" | "tab-rows-not-valid";
/** The outcome of a detection. */
export interface FormatDiagnosis {
    /** The detected format, or null when the file is not supported. */
    format: CookieFileFormat | null;
    /** The reason the file was not recognized. */
    reason?: FormatRejection;
}
/**
 * Returns the basename only, never a path that could leak directory
 * structure. Safe to log.
 */
export declare function safeBasename(filePath: string): string;
/**
 * Detect the format of cookie file text and say why it failed.
 *
 * The reason is a code. A caller that wants to tell the user what to do
 * maps the code to a sentence; the code itself never carries content.
 */
export declare function diagnoseFormat(text: string): FormatDiagnosis;
/**
 * Detect the format of cookie file text.
 */
export declare function detectFormat(text: string): CookieFileFormat | null;
/**
 * Build a DetectedFile from a path and its text contents.
 * Used by sync.ts after reading the file from disk.
 */
export declare function buildDetectedFile(filePath: string, text: string): DetectedFile;
//# sourceMappingURL=detect-format.d.ts.map
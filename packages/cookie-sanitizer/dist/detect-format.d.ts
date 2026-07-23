/**
 * Format detection — does the input look like Netscape or EditThisCookie JSON?
 *
 * Detection rule:
 *  - File extension `.json` AND first non-blank byte is `[` or `{`  →  JSON
 *  - File content has `# Netscape HTTP Cookie File` header OR
 *    ≥ 1 tab-separated 7-column row                              →  Netscape
 *  - Otherwise                                                    →  unknown
 *
 * Cookie VALUES are never copied into return values that get logged.
 * Only the basename and a 64-char prefix of the first non-blank line.
 */
import type { CookieFileFormat, DetectedFile } from "./types.js";
/**
 * Returns the basename only, never a path that could leak directory
 * structure. Safe to log.
 */
export declare function safeBasename(filePath: string): string;
/**
 * Safely truncated preview of a file's content (for diagnostics).
 * Strips cookie values to avoid leaking secrets.
 *
 * Heuristic: any line that has a tab-separated name=value pair,
 * replace the value column with `<redacted>`.
 */
export declare function safePreview(text: string, maxChars?: number): string;
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
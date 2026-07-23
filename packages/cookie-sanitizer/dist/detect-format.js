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
import { basename } from "node:path";
const HEADER_RE = /^# Netscape HTTP Cookie File/im;
const MIN_TAB_COLS = 7;
/**
 * Returns the basename only, never a path that could leak directory
 * structure. Safe to log.
 */
export function safeBasename(filePath) {
    return basename(filePath);
}
/**
 * Safely truncated preview of a file's content (for diagnostics).
 * Strips cookie values to avoid leaking secrets.
 *
 * Heuristic: any line that has a tab-separated name=value pair,
 * replace the value column with `<redacted>`.
 */
export function safePreview(text, maxChars = 64) {
    const firstLine = text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "";
    const redacted = firstLine
        .split("\t")
        .map((col, i) => (i >= 5 ? "<redacted>" : col))
        .join("\t");
    return redacted.length > maxChars
        ? `${redacted.slice(0, maxChars)}…`
        : redacted;
}
/**
 * Detect the format of cookie file text.
 */
export function detectFormat(text) {
    if (typeof text !== "string" || text.length === 0)
        return null;
    const trimmed = text.trimStart();
    const firstByte = trimmed[0];
    // JSON heuristic — array or object at the top.
    if (firstByte === "[" || firstByte === "{") {
        return "edit-this-cookie-json";
    }
    // Netscape heuristic — header OR a tab-separated 7-column row.
    if (HEADER_RE.test(text)) {
        return "netscape";
    }
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) {
            continue;
        }
        const trimmedLine = line.startsWith("#HttpOnly_")
            ? line.slice("#HttpOnly_".length)
            : line;
        const cols = trimmedLine.split("\t");
        if (cols.length >= MIN_TAB_COLS) {
            return "netscape";
        }
    }
    return null;
}
/**
 * Build a DetectedFile from a path and its text contents.
 * Used by sync.ts after reading the file from disk.
 */
export function buildDetectedFile(filePath, text) {
    const format = detectFormat(text);
    return {
        path: filePath,
        basename: safeBasename(filePath),
        format,
        text,
        // No error if format is null — unknown format is a normal case.
    };
}
//# sourceMappingURL=detect-format.js.map
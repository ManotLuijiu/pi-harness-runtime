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

import { basename } from "node:path";
import {
	hasCompatibleRow,
	looksSpaceSeparated,
} from "./parse-netscape-space.js";
import type { CookieFileFormat, DetectedFile } from "./types.js";

const HEADER_RE = /^# Netscape HTTP Cookie File/im;
const MIN_TAB_COLS = 7;

/** Why a file was not recognized. A reason code, never its content. */
export type FormatRejection =
	| "empty"
	| "no-rows"
	| "space-rows-not-valid"
	| "tab-rows-not-valid";

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
export function safeBasename(filePath: string): string {
	return basename(filePath);
}

/**
 * Detect the format of cookie file text and say why it failed.
 *
 * The reason is a code. A caller that wants to tell the user what to do
 * maps the code to a sentence; the code itself never carries content.
 */
export function diagnoseFormat(text: string): FormatDiagnosis {
	if (typeof text !== "string" || text.length === 0) {
		return { format: null, reason: "empty" };
	}

	const trimmed = text.trimStart();
	const firstByte = trimmed[0];

	// JSON heuristic — array or object at the top.
	if (firstByte === "[" || firstByte === "{") {
		return { format: "edit-this-cookie-json" };
	}

	const lines = text.split(/\r?\n/);

	// A tab-separated row is the strict Netscape format.
	let hasTabRow = false;
	for (const line of lines) {
		if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) {
			continue;
		}
		const trimmedLine = line.startsWith("#HttpOnly_")
			? line.slice("#HttpOnly_".length)
			: line;
		if (trimmedLine.split("\t").length >= MIN_TAB_COLS) {
			hasTabRow = true;
			break;
		}
	}
	if (hasTabRow) {
		return { format: "netscape" };
	}

	// The header alone is not enough: the rows decide the format.
	if (hasCompatibleRow(text)) {
		return { format: "netscape-space" };
	}
	if (HEADER_RE.test(text)) {
		// The wording of the header matches, but no row could be read.
		// The file claims the format; the parse reports that it holds no
		// cookie.
		return { format: "netscape" };
	}

	if (looksSpaceSeparated(text)) {
		return { format: null, reason: "space-rows-not-valid" };
	}

	const hasDataLine = lines.some(
		(line) => line.trim().length > 0 && !line.startsWith("#"),
	);
	return {
		format: null,
		reason: hasDataLine ? "tab-rows-not-valid" : "no-rows",
	};
}

/**
 * Detect the format of cookie file text.
 */
export function detectFormat(text: string): CookieFileFormat | null {
	return diagnoseFormat(text).format;
}

/**
 * Build a DetectedFile from a path and its text contents.
 * Used by sync.ts after reading the file from disk.
 */
export function buildDetectedFile(
	filePath: string,
	text: string,
): DetectedFile {
	const format = detectFormat(text);
	return {
		path: filePath,
		basename: safeBasename(filePath),
		format,
		text,
		// No error if format is null — unknown format is a normal case.
	};
}

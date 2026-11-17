/**
 * Netscape-format cookie file parser.
 *
 * Format reference: https://curl.haxx.se/rfc/cookie_spec.html
 *
 * Each row is tab-separated, 7 columns:
 *   domain  flag  path  secure  expires  name  value
 *
 * - Lines starting with `# ` are comments (skipped).
 * - Lines starting with `#HttpOnly_` are HTTP-only cookies
 *   (the leading `#HttpOnly_` is stripped, the rest is parsed normally).
 * - Empty lines are skipped.
 * - `expires` is Unix seconds; `0` or unparseable → session cookie.
 * - Lines with fewer than 7 columns are skipped (malformed).
 *
 * SEC-001: Cookie values are returned as strings in-memory. They MUST
 * never be logged. The scrubber in cookie-sanitizer applies value
 * redaction before any path-touching log line.
 */

import type { CanonicalCookie } from "./types.js";
import { parseCompatibleRow } from "./parse-netscape-space.js";

/** Raw row as parsed from a Netscape file. */
interface NetscapeRow {
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	expires: number; // 0 = session
	name: string;
	value: string;
}

/** The options of the Netscape parser. */
export interface ParseNetscapeOptions {
	/**
	 * Read a row that the tab split rejects with the compatible parser.
	 *
	 * A file may hold both kinds of rows: an export that a tool wrote with
	 * tabs and rows that a human typed with spaces. The fallback reads the
	 * second kind instead of dropping it. It stays off by default, so the
	 * strict parser keeps its documented behaviour.
	 */
	compatibleFallback?: boolean;
}

/** The outcome of a parse: the cookies and the counts of the rows. */
export interface ParseNetscapeResult {
	cookies: CanonicalCookie[];
	/** Rows that were read. */
	accepted: number;
	/** Rows that looked like a row but did not validate. */
	rejected: number;
}

/**
 * Parse a Netscape-format cookie string into canonical records.
 *
 * Skips:
 * - blank lines
 * - comments (lines starting with `#` but not `#HttpOnly_`)
 * - malformed rows (< 7 columns)
 *
 * Never throws; returns empty array if input is invalid.
 */
export function parseNetscape(
	text: string,
	options: ParseNetscapeOptions = {},
): CanonicalCookie[] {
	return parseNetscapeDetailed(text, options).cookies;
}

/**
 * Parse a Netscape-format cookie string and report the counts of the rows.
 *
 * The counts are what a diagnostic may show. The rows themselves stay in
 * memory and never reach a log line.
 */
export function parseNetscapeDetailed(
	text: string,
	options: ParseNetscapeOptions = {},
): ParseNetscapeResult {
	const result: ParseNetscapeResult = {
		cookies: [],
		accepted: 0,
		rejected: 0,
	};
	if (typeof text !== "string" || text.length === 0) return result;

	const rows: NetscapeRow[] = [];
	const lines = text.split(/\r?\n/);

	for (const raw of lines) {
		if (!raw) continue;

		let line = raw;
		let httpOnly = false;
		if (line.startsWith("#HttpOnly_")) {
			httpOnly = true;
			line = line.slice("#HttpOnly_".length);
		} else if (line.startsWith("#")) {
			// Plain comment line (Netscape / curl spec).
			continue;
		}

		const cols = line.split("\t");
		if (cols.length < 7) {
			const compatible = options.compatibleFallback
				? parseCompatibleRow(raw)
				: null;
			if (compatible?.kind === "accepted") {
				result.cookies.push(compatible.cookie);
				result.accepted++;
				continue;
			}
			if (compatible?.kind === "rejected") {
				result.rejected++;
				continue;
			}
			// The strict parser skips a row it cannot read. The count is
			// what a diagnostic may show; the row itself stays unread.
			result.rejected++;
			continue;
		}

		const [domain, _flag, cookiePath, secure, expires, name, value] = cols;
		if (!name || !value) {
			result.rejected++;
			continue;
		}

		rows.push({
			domain: (domain ?? "").trim(),
			path: (cookiePath ?? "/").trim() || "/",
			secure: (secure ?? "FALSE").toUpperCase() === "TRUE",
			httpOnly,
			expires: parseInt(expires ?? "0", 10) || 0,
			name: name.trim(),
			value, // intentional: keep as-is for in-memory pipeline; never log
		});
	}

	// Map to CanonicalCookie shape.
	for (const r of rows) {
		result.cookies.push({
			name: r.name,
			value: r.value,
			domain: r.domain,
			path: r.path,
			expires: r.expires === 0 ? undefined : r.expires,
			secure: r.secure,
			httpOnly: r.httpOnly,
		});
		result.accepted++;
	}
	return result;
}

/**
 * Serialize a list of canonical cookies back to Netscape format.
 * Used by atomic-write.ts to produce the canonical cache.
 *
 * Output uses the canonical column order:
 *   domain  flag  path  secure  expires  name  value
 *
 * `flag` is FALSE per curl spec (HttpOnly is encoded as `#HttpOnly_`).
 * Cookie values are NEVER logged during the round-trip.
 */
export function serializeNetscape(cookies: CanonicalCookie[]): string {
	const out: string[] = ["# Netscape HTTP Cookie File", ""];

	for (const c of cookies) {
		if (!c.name || !c.value) continue;
		const domain = c.domain ?? "";
		const path = c.path ?? "/";
		const secure = c.secure ? "TRUE" : "FALSE";
		const expires = c.expires != null ? String(c.expires) : "0";
		const line = [domain, "FALSE", path, secure, expires, c.name, c.value].join(
			"\t",
		);
		out.push(c.httpOnly ? `#HttpOnly_${line}` : line);
	}

	return out.join("\n") + "\n";
}

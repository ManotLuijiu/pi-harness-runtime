/**
 * The compatible parser for a space-delimited cookie export.
 *
 * The sanitizer promised forgiving input from its first commit: "any
 * cookie file (any name, any format)". The strict parser splits a row on
 * tabs only, so an export whose rows are separated by spaces was
 * rejected — even though its rows carry exactly the fields of the
 * Netscape format. The promise and the implementation disagreed, and the
 * implementation won until now.
 *
 * The variant that this parser accepts:
 *
 *   <domain> <flag> <path> <secure> <expiry> <name> <value…>
 *
 * The first six fields are single tokens; the value is the rest of the
 * line, so a value may contain spaces. A row is accepted only when every
 * field validates. An ambiguous row is rejected, never guessed: a wrong
 * guess would publish a cookie that the account never had.
 *
 * SEC-001: values live in memory only. Nothing in this module logs a
 * value, a cookie name, or a raw line.
 */
import type { CanonicalCookie } from "./types.js";
/** The outcome of a single row. */
export type CompatibleRowOutcome = {
    kind: "accepted";
    cookie: CanonicalCookie;
} | {
    kind: "rejected";
    reason: CompatibleRowRejection;
};
/** Why a row was rejected. A reason code, never the row itself. */
export type CompatibleRowRejection = "not-a-row" | "invalid-domain" | "invalid-flag" | "invalid-path" | "invalid-secure" | "invalid-expiry" | "missing-value";
/** The result of a whole file. */
export interface CompatibleParseResult {
    cookies: CanonicalCookie[];
    /** Rows that were read. */
    accepted: number;
    /** Rows that looked like a row but did not validate. */
    rejected: number;
    /** Why the rows were rejected, counted per reason. */
    rejections: Record<CompatibleRowRejection, number>;
}
/**
 * Parse one line of a space-delimited export.
 *
 * Returns `null` when the line is not a row at all (an empty line or a
 * comment). A row that is not valid returns a rejection with its reason.
 */
export declare function parseCompatibleRow(line: string): CompatibleRowOutcome | null;
/**
 * Parse a whole space-delimited export.
 *
 * Never throws. Returns the cookies and the counts of the rows that were
 * read and of the rows that were rejected, so a diagnostic can report the
 * counts without the content.
 */
export declare function parseNetscapeSpace(text: string): CompatibleParseResult;
/**
 * Does the text hold a row that the compatible parser accepts?
 *
 * Used by the detection: a file whose rows are space-separated is a
 * supported format, even when its header wording is unusual.
 */
export declare function hasCompatibleRow(text: string): boolean;
/**
 * Does the text hold a row that looks space-separated, valid or not?
 *
 * The diagnostic needs to tell "the rows use spaces" from "the file holds
 * no rows at all", and it may say so without naming a cookie.
 */
export declare function looksSpaceSeparated(text: string): boolean;
//# sourceMappingURL=parse-netscape-space.d.ts.map
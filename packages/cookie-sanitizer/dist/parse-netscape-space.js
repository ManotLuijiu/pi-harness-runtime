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
/** The six leading fields and the value that follows them. */
const ROW_RE = /^(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)(?:[ \t](.*))?$/;
/** A hostname, optionally with a leading dot for the sub-domains. */
const DOMAIN_RE = /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
/** The Netscape flag and the secure marker are TRUE or FALSE. */
const BOOLEAN_RE = /^(TRUE|FALSE)$/i;
/** The expiry is a whole number of seconds since the epoch. */
const EXPIRY_RE = /^\d+$/;
/**
 * Parse one line of a space-delimited export.
 *
 * Returns `null` when the line is not a row at all (an empty line or a
 * comment). A row that is not valid returns a rejection with its reason.
 */
export function parseCompatibleRow(line) {
    let text = line;
    let httpOnly = false;
    if (text.startsWith("#HttpOnly_")) {
        httpOnly = true;
        text = text.slice("#HttpOnly_".length);
    }
    else if (text.startsWith("#")) {
        // A comment of the Netscape format (including the header).
        return null;
    }
    if (!text.trim())
        return null;
    const match = ROW_RE.exec(text);
    if (!match)
        return { kind: "rejected", reason: "not-a-row" };
    const [, domain, flag, cookiePath, secure, expires, name, value] = match;
    if (!DOMAIN_RE.test(domain))
        return { kind: "rejected", reason: "invalid-domain" };
    if (!BOOLEAN_RE.test(flag))
        return { kind: "rejected", reason: "invalid-flag" };
    if (!cookiePath.startsWith("/"))
        return { kind: "rejected", reason: "invalid-path" };
    if (!BOOLEAN_RE.test(secure))
        return { kind: "rejected", reason: "invalid-secure" };
    if (!EXPIRY_RE.test(expires))
        return { kind: "rejected", reason: "invalid-expiry" };
    // The value is the rest of the line. A row without one carries nothing.
    if (value === undefined || value.length === 0) {
        return { kind: "rejected", reason: "missing-value" };
    }
    const expiry = Number.parseInt(expires, 10);
    return {
        kind: "accepted",
        cookie: {
            name,
            value,
            domain,
            path: cookiePath,
            expires: expiry === 0 ? undefined : expiry,
            secure: secure.toUpperCase() === "TRUE",
            httpOnly,
        },
    };
}
/**
 * Parse a whole space-delimited export.
 *
 * Never throws. Returns the cookies and the counts of the rows that were
 * read and of the rows that were rejected, so a diagnostic can report the
 * counts without the content.
 */
export function parseNetscapeSpace(text) {
    const result = {
        cookies: [],
        accepted: 0,
        rejected: 0,
        rejections: {
            "not-a-row": 0,
            "invalid-domain": 0,
            "invalid-flag": 0,
            "invalid-path": 0,
            "invalid-secure": 0,
            "invalid-expiry": 0,
            "missing-value": 0,
        },
    };
    if (typeof text !== "string" || text.length === 0)
        return result;
    for (const raw of text.split(/\r?\n/)) {
        const outcome = parseCompatibleRow(raw);
        if (!outcome)
            continue;
        if (outcome.kind === "accepted") {
            result.cookies.push(outcome.cookie);
            result.accepted++;
            continue;
        }
        result.rejected++;
        result.rejections[outcome.reason]++;
    }
    return result;
}
/**
 * Does the text hold a row that the compatible parser accepts?
 *
 * Used by the detection: a file whose rows are space-separated is a
 * supported format, even when its header wording is unusual.
 */
export function hasCompatibleRow(text) {
    if (typeof text !== "string" || text.length === 0)
        return false;
    for (const raw of text.split(/\r?\n/)) {
        const outcome = parseCompatibleRow(raw);
        if (outcome?.kind === "accepted")
            return true;
    }
    return false;
}
/**
 * Does the text hold a row that looks space-separated, valid or not?
 *
 * The diagnostic needs to tell "the rows use spaces" from "the file holds
 * no rows at all", and it may say so without naming a cookie.
 */
export function looksSpaceSeparated(text) {
    if (typeof text !== "string" || text.length === 0)
        return false;
    for (const raw of text.split(/\r?\n/)) {
        if (!raw || raw.startsWith("#"))
            continue;
        if (raw.includes("\t"))
            continue;
        return true;
    }
    return false;
}
//# sourceMappingURL=parse-netscape-space.js.map
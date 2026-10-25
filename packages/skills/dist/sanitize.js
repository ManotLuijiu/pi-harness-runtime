/**
 * The sanitization of a skill for the shared collection.
 *
 * The collection is shared, so a client name must not travel into it. The
 * rules lived in `scripts/sync-to-qdrant.ts` - the only writer that could
 * reach them. The runtime registry writes into the same collection, so it
 * needs them too: a writer that skipped the rules would leave the raw
 * name and the raw body of a client skill in a shared cluster.
 *
 * Both writers therefore build their points with the same rules, and the
 * name of a point is the sanitized name. One skill, one point.
 */
/**
 * The patterns of the client specific names.
 *
 * The list is about the names of the clients and the projects of the
 * users of the harness - not about the skills themselves.
 */
const SANITIZATION_RULES = [
    // Client company names (case-insensitive)
    { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
    { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
    { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
    { pattern: /\bclient-b\b/gi, replacement: "[Client B]" },
    // Project/app specific names
    { pattern: /\binsurance-project\b/gi, replacement: "[Insurance Project]" },
    { pattern: /\bimport-project\b/gi, replacement: "[Import Project]" },
    { pattern: /\bclient-b_erp\b/gi, replacement: "[Client B Erp]" },
    { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
    { pattern: /\bclient-a_\b/gi, replacement: "[Client A]_" },
    { pattern: /\bpaperclip_\b/gi, replacement: "[Client D]_" },
    { pattern: /\bopenclaw_\b/gi, replacement: "[Client F]_" },
    // Generic replacements
    { pattern: /Company Name/gi, replacement: "[Client Name]" },
    { pattern: /your company/gi, replacement: "[Client]" },
    { pattern: /our client/gi, replacement: "[Client]" },
    { pattern: /client-specific/gi, replacement: "[Project-specific]" },
];
/**
 * The names that are renamed as a whole.
 *
 * A name that would be unreadable after the pattern rules - a name that
 * carries the client name in its middle - is renamed here.
 */
const SKILL_NAME_MAP = {
    "insurance-project-step5-slot-filter": "insurance-project-step-filter",
    "client-a-pe-approval-workflow": "client-a-pe-approval-workflow",
    "client-a-po-approval-workflow": "client-a-po-approval-workflow",
    "client-a-pr-approval-workflow": "client-a-pr-approval-workflow",
    "import-project-clearance-lcv": "import-project-clearance",
    whispertool: "whisper-tool",
};
/**
 * Replace the client specific names of a text.
 *
 * The text stays the same length, so a vector that was built from it
 * keeps its shape.
 */
export function sanitizeText(text) {
    let result = text;
    for (const rule of SANITIZATION_RULES) {
        result = result.replace(rule.pattern, rule.replacement);
    }
    return result;
}
/**
 * The name of a skill in the shared collection.
 *
 * The name is the identity of the point, so it has to be the same for
 * every writer: the map first, then the pattern rules.
 */
export function skillPointName(name) {
    return SKILL_NAME_MAP[name] || sanitizeText(name);
}
//# sourceMappingURL=sanitize.js.map
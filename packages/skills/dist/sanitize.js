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
 *
 * The patterns match a plain fragment, without a word boundary. A client
 * name rarely stands alone: it appears inside a directory name
 * (`th_client-b_erp_chart.json`), inside a Python module (`client-a_pharma`)
 * or in a sentence ("integrated with Paperclip"). A word boundary would
 * miss all of them - and `_` is a word character, so a boundary never
 * follows an underscore.
 */
const SANITIZATION_RULES = [
    // Client company names (case-insensitive)
    { pattern: /client-a/gi, replacement: "[Client A]" },
    { pattern: /client-a/gi, replacement: "[Client A]" },
    { pattern: /client-a/gi, replacement: "[Client A]" },
    { pattern: /client-b/gi, replacement: "[Client B]" },
    // Project/app specific names
    { pattern: /insurance-project/gi, replacement: "[Insurance Project]" },
    { pattern: /import-project/gi, replacement: "[Import Project]" },
    { pattern: /paperclip/gi, replacement: "[Client D]" },
    { pattern: /openclaw/gi, replacement: "[Client F]" },
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
 *
 * The result is a skill name - lower case, words separated by a dash -
 * because the name of a point is also the id of the skill that a search
 * returns. The replacements of the rules carry a space and brackets,
 * which no skill name may hold.
 */
export function skillPointName(name) {
    const mapped = SKILL_NAME_MAP[name];
    if (mapped)
        return mapped;
    return kebabName(sanitizeText(name));
}
/**
 * Bring a name into the shape of a skill name.
 *
 * The name of a skill is lower case and its words are separated by a
 * dash: `^[a-z0-9]+(-[a-z0-9]+)*$`.
 */
function kebabName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
}
//# sourceMappingURL=sanitize.js.map
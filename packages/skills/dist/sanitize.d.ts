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
 *
 * The rules themselves are not in this file. The names of the clients of
 * the users of the harness are not in this repository - it is public, and
 * a list of client names in it is a list of client names in the world.
 * The rules live in a local file, and `sanitize-rules.ts` reads them. See
 * that module for the format.
 */
import { type SanitizationRuleSet } from "./sanitize-rules.js";
export type { SanitizationRule, SanitizationRuleSet } from "./sanitize-rules.js";
export { loadSanitizationRules, resetSanitizationRulesCache, sanitizationFilePath, sanitizationStatus, } from "./sanitize-rules.js";
/**
 * Replace the client specific names of a text.
 *
 * The text stays the same length, so a vector that was built from it
 * keeps its shape.
 *
 * The rules are the ones of this installation unless a set is passed in.
 */
export declare function sanitizeText(text: string, rules?: SanitizationRuleSet): string;
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
export declare function skillPointName(name: string, rules?: SanitizationRuleSet): string;
//# sourceMappingURL=sanitize.d.ts.map
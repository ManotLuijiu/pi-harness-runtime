/**
 * The rules that keep a client name out of the shared collection.
 *
 * The names of the clients of the users of the harness are **not** in this
 * repository. The repository is public, and a list of client names in it
 * is a list of client names in the world - the names of the projects and
 * of the clients of every person who installs the package.
 *
 * The rules therefore live in a local file:
 *
 *   ~/.pi-harness-runtime/skill-sanitization.json
 *
 * and this module is the mechanism that reads them and applies them. The
 * file is per installation, so a machine holds the rules of its own
 * clients and nobody else's.
 *
 * The file is optional. Without it only the generic rules apply, and the
 * name of a client would travel into the collection of that installation.
 * `sanitizationStatus()` tells the caller which of the two is the case,
 * so a missing file is a visible state and not a silent one.
 *
 * The format of the file:
 *
 * ```json
 * {
 *   "rules": [
 *     { "pattern": "acme", "replacement": "[Client A]", "flags": "gi" }
 *   ],
 *   "nameMap": {
 *     "acme-approval-workflow": "client-a-approval-workflow"
 *   }
 * }
 * ```
 *
 * The pattern is the source of a regular expression and the flags default
 * to "gi". The rules match a plain fragment, without a word boundary: a
 * client name rarely stands alone, it appears inside a directory name
 * (`erp_report_2024.json`), inside a module name (`acme_pharma`) or in a
 * sentence ("integrated with Acme"). A word boundary would miss all of
 * them - and `_` is a word character, so a boundary never follows an
 * underscore.
 */
/** A rule as it is written in the local file. */
export interface SanitizationRuleSpec {
    /** The source of a regular expression. */
    pattern: string;
    /** What a match becomes. */
    replacement: string;
    /** The flags of the regular expression. Defaults to "gi". */
    flags?: string;
}
/** A compiled rule. */
export interface SanitizationRule {
    pattern: RegExp;
    replacement: string;
}
/** The whole rule set of one installation. */
export interface SanitizationRuleSet {
    /** The rules, in the order they are applied. */
    rules: SanitizationRule[];
    /** The names that are renamed as a whole. */
    nameMap: Record<string, string>;
    /** Where the rules came from. */
    source: "local-file" | "generic-only";
    /** Why the local file did not contribute its rules. */
    error?: string;
}
/** Where the rules of this installation live. */
export declare function sanitizationFilePath(): string;
/**
 * The state of the rules of this installation.
 *
 * `configured` is false when the local file is missing or unreadable. The
 * caller shows it, because a missing file is a weaker privacy guarantee
 * and not a detail.
 */
export declare function sanitizationStatus(): {
    configured: boolean;
    path: string;
    ruleCount: number;
    error?: string;
};
/**
 * The rules of this installation.
 *
 * The file is read once per process: the rules do not change while the
 * harness runs, and a skill that is indexed a hundred times must not read
 * a file a hundred times.
 */
export declare function loadSanitizationRules(path?: string): SanitizationRuleSet;
/** Forget the cached rules. A test needs it, a new file needs it. */
export declare function resetSanitizationRulesCache(): void;
//# sourceMappingURL=sanitize-rules.d.ts.map
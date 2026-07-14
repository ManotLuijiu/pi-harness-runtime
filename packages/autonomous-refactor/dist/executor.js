/**
 * Autonomous Refactor — Executor
 *
 * Applies code modifications using AST-based transformations.
 */
import { writeFile } from "node:fs/promises";
// ─── Rule Application ─────────────────────────────────────────────────
/**
 * Apply a rule match to a file
 */
export async function applyRule(rule, match, options) {
    try {
        let { content } = match;
        let applied = false;
        if (rule.pattern) {
            const flags = rule.flags ?? "g";
            const regex = new RegExp(rule.pattern, flags);
            const count = (content.match(regex) ?? []).length;
            if (count > 0) {
                content = content.replace(regex, rule.replacement ?? "");
                applied = true;
            }
        }
        if (!applied) {
            return {
                applied: false,
                message: "Pattern not found in file",
            };
        }
        if (options.dryRun) {
            return {
                applied: true,
                dryRun: true,
                message: "Would apply changes",
                patch: content,
            };
        }
        await writeFile(match.filePath, content, "utf-8");
        return {
            applied: true,
            message: `Applied ${rule.id} to ${match.filePath}`,
            patch: content,
        };
    }
    catch (err) {
        return {
            applied: false,
            message: `Failed to apply: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
/**
 * Apply all rules to a set of matches
 */
export async function applyAllRules(rules, matches, options) {
    const results = [];
    for (const match of matches) {
        const rule = rules.find((r) => r.id === match.ruleId);
        if (!rule) {
            results.push({
                applied: false,
                message: `Rule ${match.ruleId} not found`,
            });
            continue;
        }
        const result = await applyRule(rule, match, options);
        results.push(result);
    }
    return results;
}
//# sourceMappingURL=executor.js.map
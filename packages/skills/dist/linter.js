/**
 * Skill Linter
 *
 * Hermes-style quality checks for skills.
 * Ensures skills capture "lessons, not logs".
 */
/**
 * Hermes-style linter rules
 */
export const LINTER_RULES = [
    // === Quality Rules ===
    {
        name: "incident-log-shape",
        description: "Body contains too many PR/issue references (looks like incident log)",
        severity: "warning",
        check: (skill) => {
            // Count PR/issue references like #123, PR #456, issue #789
            const prIssueRefs = skill.body.match(/(?:PR|issue|#)\s*\d+/gi) ?? [];
            if (prIssueRefs.length > 5) {
                return {
                    rule: "incident-log-shape",
                    severity: "warning",
                    message: `Found ${prIssueRefs.length} PR/issue references. Skills should capture rules, not incident logs.`,
                };
            }
            return null;
        },
    },
    {
        name: "references-sprawl",
        description: "Too many reference files (>60)",
        severity: "error",
        check: (skill) => {
            if (skill.references.length > 60) {
                return {
                    rule: "references-sprawl",
                    severity: "error",
                    message: `Found ${skill.references.length} reference files. Skills should consolidate references.`,
                };
            }
            return null;
        },
    },
    {
        name: "oversized-body",
        description: "SKILL.md exceeds 24k characters",
        severity: "warning",
        check: (skill) => {
            if (skill.body.length > 24000) {
                return {
                    rule: "oversized-body",
                    severity: "warning",
                    message: `SKILL.md body is ${skill.body.length} chars (exceeds 24k). Consider splitting into references.`,
                };
            }
            return null;
        },
    },
    {
        name: "missing-pitfalls",
        description: "No pitfalls with 'why' explanations",
        severity: "info",
        check: (skill) => {
            const hasPitfalls = skill.hermes?.pitfalls && skill.hermes.pitfalls.length > 0;
            const hasWhy = skill.body.toLowerCase().includes("why");
            if (!hasPitfalls && !hasWhy) {
                return {
                    rule: "missing-pitfalls",
                    severity: "info",
                    message: "No pitfalls found. Consider documenting common mistakes and why they happen.",
                };
            }
            return null;
        },
    },
    {
        name: "missing-examples",
        description: "No examples provided",
        severity: "info",
        check: (skill) => {
            if (skill.examples.length === 0) {
                return {
                    rule: "missing-examples",
                    severity: "info",
                    message: "No examples found. Consider adding example files to demonstrate the skill.",
                };
            }
            return null;
        },
    },
    // === pi.dev Compatibility Rules ===
    {
        name: "missing-description",
        description: "No description in frontmatter",
        severity: "error",
        check: (skill) => {
            if (!skill.frontmatter.description || skill.frontmatter.description.length < 10) {
                return {
                    rule: "missing-description",
                    severity: "error",
                    message: "Missing or too short description. The description determines when the model considers loading the skill.",
                };
            }
            return null;
        },
    },
    {
        name: "invalid-name",
        description: "Name contains invalid characters",
        severity: "error",
        check: (skill) => {
            const nameRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
            if (!nameRegex.test(skill.frontmatter.name)) {
                return {
                    rule: "invalid-name",
                    severity: "error",
                    message: `Invalid skill name '${skill.frontmatter.name}'. Must be kebab-case (e.g., 'code-review').`,
                };
            }
            return null;
        },
    },
    {
        name: "name-mismatch",
        description: "Directory name doesn't match skill name",
        severity: "warning",
        check: (skill) => {
            const dirName = skill.path.split("/").pop() ?? "";
            if (dirName !== skill.frontmatter.name && dirName !== "") {
                return {
                    rule: "name-mismatch",
                    severity: "warning",
                    message: `Directory name '${dirName}' differs from skill name '${skill.frontmatter.name}'. Consider matching them for portability.`,
                };
            }
            return null;
        },
    },
    // === Hermes-Specific Rules ===
    {
        name: "missing-triggers",
        description: "No triggers defined for auto-matching",
        severity: "info",
        check: (skill) => {
            const hasTriggers = skill.hermes?.triggers && skill.hermes.triggers.length > 0;
            if (!hasTriggers) {
                return {
                    rule: "missing-triggers",
                    severity: "info",
                    message: "No triggers defined. The skill relies only on description matching.",
                };
            }
            return null;
        },
    },
    {
        name: "low-confidence",
        description: "Skill has low confidence score",
        severity: "info",
        check: (skill) => {
            const confidence = skill.hermes?.confidence;
            if (confidence !== undefined && confidence < 0.5) {
                return {
                    rule: "low-confidence",
                    severity: "info",
                    message: `Low confidence score (${confidence}). Consider validating this skill pattern.`,
                };
            }
            return null;
        },
    },
    {
        name: "unused-skill",
        description: "Skill has never been used",
        severity: "info",
        check: (skill) => {
            const usageCount = skill.hermes?.usage_count ?? 0;
            if (usageCount === 0 && skill.hermes?.created_at) {
                return {
                    rule: "unused-skill",
                    severity: "info",
                    message: "This skill has never been used. Consider testing or archiving it.",
                };
            }
            return null;
        },
    },
    {
        name: "generic-description",
        description: "Description is too generic",
        severity: "warning",
        check: (skill) => {
            const genericPhrases = [
                "helps with",
                "useful for",
                "does things",
                "stuff",
                "things",
            ];
            const descLower = skill.frontmatter.description.toLowerCase();
            for (const phrase of genericPhrases) {
                if (descLower.includes(phrase)) {
                    return {
                        rule: "generic-description",
                        severity: "warning",
                        message: `Description contains generic phrase '${phrase}'. Be specific about what the skill does and when to use it.`,
                    };
                }
            }
            return null;
        },
    },
    {
        name: "log-like-content",
        description: "Body contains log-like content (timestamps, repeated patterns)",
        severity: "warning",
        check: (skill) => {
            // Check for log patterns
            const logPatterns = [
                /\d{4}-\d{2}-\d{2}/, // dates
                /\d{2}:\d{2}:\d{2}/, // timestamps
                /^(?:INFO|ERROR|WARN|DEBUG)/m, // log levels
                /^\d+\.\s/m, // numbered lists (too detailed)
            ];
            let matchCount = 0;
            for (const pattern of logPatterns) {
                if (pattern.test(skill.body)) {
                    matchCount++;
                }
            }
            if (matchCount >= 2) {
                return {
                    rule: "log-like-content",
                    severity: "warning",
                    message: "Body contains log-like patterns. Skills should capture procedures and rules, not logs.",
                };
            }
            return null;
        },
    },
];
/**
 * Lint a skill
 */
export function lintSkill(skill, rules) {
    const rulesToUse = rules ?? LINTER_RULES;
    const results = [];
    for (const rule of rulesToUse) {
        try {
            const result = rule.check(skill);
            if (result) {
                results.push(result);
            }
        }
        catch (err) {
            results.push({
                rule: rule.name,
                severity: "error",
                message: `Linter error: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    }
    return results;
}
/**
 * Lint a skill and return formatted output
 */
export function lintSkillFormatted(skill, rules) {
    const results = lintSkill(skill, rules);
    if (results.length === 0) {
        return `✓ ${skill.id}: No issues found`;
    }
    const lines = [`✗ ${skill.id}:`];
    for (const result of results) {
        const icon = result.severity === "error" ? "✗" : result.severity === "warning" ? "⚠" : "ℹ";
        lines.push(`  ${icon} [${result.severity}] ${result.rule}: ${result.message}`);
    }
    return lines.join("\n");
}
/**
 * Get lint summary for multiple skills
 */
export function lintSkillsSummary(skills) {
    const summary = {
        total: skills.length,
        passed: 0,
        failed: 0,
        bySeverity: { error: 0, warning: 0, info: 0 },
        byRule: {},
    };
    for (const skill of skills) {
        const results = lintSkill(skill);
        if (results.length === 0) {
            summary.passed++;
        }
        else {
            summary.failed++;
            for (const result of results) {
                summary.bySeverity[result.severity]++;
                summary.byRule[result.rule] = (summary.byRule[result.rule] ?? 0) + 1;
            }
        }
    }
    return summary;
}
/**
 * Create custom lint rule
 */
export function createLintRule(name, description, severity, check) {
    return { name, description, severity, check };
}
/**
 * Filter lint results by severity
 */
export function filterLintResults(results, minSeverity) {
    const severityOrder = ["info", "warning", "error"];
    const minIndex = severityOrder.indexOf(minSeverity);
    return results.filter((result) => {
        const resultIndex = severityOrder.indexOf(result.severity);
        return resultIndex >= minIndex;
    });
}
//# sourceMappingURL=linter.js.map
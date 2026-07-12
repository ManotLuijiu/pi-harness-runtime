/**
 * Prompt Compiler - Section Builder
 *
 * Assembles prompt sections from a normalized request.
 * Each section is built independently for testability.
 */
/**
 * Build all prompt sections from a normalized request.
 * Section order is deterministic per RFC-0041.
 */
export function buildSections(normalized, projectRules) {
    const sections = [];
    // 1. Runtime identity
    sections.push(buildIdentitySection(normalized));
    // 2. Project rules
    if (projectRules.length > 0) {
        sections.push(buildProjectRulesSection(projectRules));
    }
    // 3. Objective
    sections.push(buildObjectiveSection(normalized));
    // 4. Acceptance criteria
    if (normalized.acceptanceCriteria.length > 0) {
        sections.push(buildAcceptanceCriteriaSection(normalized));
    }
    // 5. Relevant context
    if (normalized.contextEntries.length > 0) {
        sections.push(buildContextSection(normalized));
    }
    // 6. Known constraints
    if (normalized.constraints.length > 0) {
        sections.push(buildConstraintsSection(normalized));
    }
    // 7. Files in scope
    if (normalized.filesInScope.length > 0) {
        sections.push(buildFilesInScopeSection(normalized));
    }
    // 8. Required output
    if (normalized.expectedOutputs.length > 0) {
        sections.push(buildRequiredOutputSection(normalized));
    }
    // 9. Tool permissions
    if (normalized.toolPermissions.length > 0) {
        sections.push(buildToolPermissionsSection(normalized));
    }
    // 10. Continuation instructions
    if (normalized.continuation) {
        sections.push(buildContinuationSection(normalized));
    }
    return sections;
}
// ─── Section builders ───────────────────────────────────────────────────
function buildIdentitySection(req) {
    const lines = [
        "# Task Identity",
        "",
        `Task ID: ${req.taskId}`,
        `Requirement: ${req.requirementId}`,
        `Provider: ${req.provider}`,
        `Attempt: ${req.attempt}`,
    ];
    return {
        id: "identity",
        kind: "identity",
        content: lines.join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [],
    };
}
function buildProjectRulesSection(rules) {
    return {
        id: "project_rules",
        kind: "project_rules",
        content: [
            "# Project Rules",
            "",
            ...rules.map((rule, i) => `${i + 1}. ${rule}`),
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [],
    };
}
function buildObjectiveSection(req) {
    return {
        id: "objective",
        kind: "objective",
        content: [
            "# Objective",
            "",
            req.objective || "(no objective provided)",
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [],
    };
}
function buildAcceptanceCriteriaSection(req) {
    return {
        id: "acceptance_criteria",
        kind: "acceptance_criteria",
        content: [
            "# Acceptance Criteria",
            "",
            ...req.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`),
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [],
    };
}
function buildContextSection(req) {
    const lines = ["# Relevant Context", ""];
    for (const entry of req.contextEntries) {
        const priorityLabel = entry.priority === 0
            ? "[CRITICAL]"
            : entry.priority <= 3
                ? "[IMPORTANT]"
                : entry.priority <= 6
                    ? "[USEFUL]"
                    : "[SUPPLEMENTAL]";
        lines.push(`## ${priorityLabel} ${entry.source}`);
        lines.push(entry.content);
        lines.push("");
    }
    return {
        id: "relevant_context",
        kind: "relevant_context",
        content: lines.join("\n"),
        required: false,
        compactable: true,
        sourceRefs: req.contextEntries.map((e) => ({
            source: e.source,
            text: e.content.slice(0, 200),
        })),
    };
}
function buildConstraintsSection(req) {
    return {
        id: "known_constraints",
        kind: "known_constraints",
        content: [
            "# Known Constraints",
            "",
            ...req.constraints.map((c, i) => `${i + 1}. ${c}`),
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [],
    };
}
function buildFilesInScopeSection(req) {
    return {
        id: "files_in_scope",
        kind: "files_in_scope",
        content: [
            "# Files in Scope",
            "",
            "Only modify or create files listed below:",
            "",
            ...req.filesInScope.map((f) => `- ${f}`),
            "",
            "Do NOT modify any other files unless explicitly required.",
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: req.filesInScope.map((f) => ({ source: f, text: f })),
    };
}
function buildRequiredOutputSection(req) {
    return {
        id: "required_output",
        kind: "required_output",
        content: [
            "# Required Output",
            "",
            "Produce the following outputs to mark this task complete:",
            "",
            ...req.expectedOutputs.map((o) => `- ${o}`),
            "",
            "Each output must be verified before marking the task done.",
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [],
    };
}
function buildToolPermissionsSection(req) {
    return {
        id: "tool_permissions",
        kind: "tool_permissions",
        content: [
            "# Tool Permissions",
            "",
            "You may use the following tools:",
            "",
            ...req.toolPermissions.map((t) => `- ${t}`),
            "",
            "Do NOT run any other commands without explicit approval.",
        ].join("\n"),
        required: false,
        compactable: true,
        sourceRefs: [],
    };
}
function buildContinuationSection(req) {
    const cont = req.continuation;
    const completedLines = cont.completedItems.length > 0
        ? [
            "",
            "## Completed (do not repeat)",
            "",
            ...cont.completedItems.map((item) => `- ~~${item}~~ [DONE]`),
        ]
        : [];
    const incompleteLines = cont.incompleteItems.length > 0
        ? [
            "",
            "## Incomplete (continue these)",
            "",
            ...cont.incompleteItems.map((item) => `- ${item}`),
        ]
        : [];
    return {
        id: "continuation_instructions",
        kind: "continuation_instructions",
        content: [
            "# Continuation",
            "",
            "Continue from where the previous attempt stopped.",
            "Do not repeat completed work.",
            ...completedLines,
            ...incompleteLines,
        ].join("\n"),
        required: true,
        compactable: false,
        sourceRefs: [
            { source: cont.previousResponsePath, text: "[Previous response]" },
        ],
    };
}
//# sourceMappingURL=section-builder.js.map
/**
 * Prompt Compiler - Rendering
 *
 * Renders assembled sections into provider-specific prompt strings.
 * Provider-specific formatting is applied here only.
 * Core semantics must remain provider-independent.
 */
import { SECTION_ORDER } from "./types.js";
/**
 * Render sections into provider-specific prompt strings.
 *
 * System-prompt-supporting providers get rules in system, rest in user.
 * Objective and acceptance criteria always go in user.
 */
export function renderForProvider(sections, profile) {
    // Sort sections deterministically
    const sorted = [...sections].sort((a, b) => {
        const aIdx = SECTION_ORDER.indexOf(a.kind);
        const bIdx = SECTION_ORDER.indexOf(b.kind);
        if (aIdx !== bIdx)
            return aIdx - bIdx;
        return a.id.localeCompare(b.id);
    });
    // Separate into system vs user content
    const systemSections = profile.supportsSystemPrompt
        ? sorted.filter((s) => s.kind === "project_rules" || s.kind === "tool_permissions")
        : [];
    const userSections = sorted.filter((s) => s.kind !== "tool_permissions" || !profile.supportsSystemPrompt);
    const system = renderSections(systemSections, profile);
    const user = renderSections(userSections, profile);
    return { system, user };
}
function renderSections(sections, profile) {
    const rendered = sections
        .filter((s) => s.content.trim())
        .map((s) => s.content)
        .join("\n\n---\n\n");
    return formatContent(rendered, profile.preferredInstructionStyle);
}
function formatContent(content, style) {
    if (!content.trim())
        return "";
    switch (style) {
        case "xml":
            return formatXml(content);
        case "markdown":
            return formatMarkdown(content);
        default:
            return stripMarkdown(content);
    }
}
function formatXml(content) {
    return [
        "<instructions>",
        content
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n"),
        "</instructions>",
    ].join("\n");
}
function formatMarkdown(content) {
    return content;
}
function stripMarkdown(content) {
    return content
        .replace(/^#{1,6}\s+/gm, "") // headers
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
        .replace(/[*_`~]/g, "") // emphasis
        .replace(/^\s*[-*+]\s+/gm, "- ") // list items
        .trim();
}
//# sourceMappingURL=render.js.map
/**
 * Prompt Compiler - Rendering
 *
 * Renders assembled sections into provider-specific prompt strings.
 * Provider-specific formatting is applied here only.
 * Core semantics must remain provider-independent.
 */

import type { PromptSection, ProviderPromptProfile } from "./types.js";
import { SECTION_ORDER } from "./types.js";

/**
 * Rendered prompt strings.
 */
export interface RenderedPrompt {
	system: string;
	user: string;
}

/**
 * Render sections into provider-specific prompt strings.
 *
 * System-prompt-supporting providers get rules in system, rest in user.
 * Objective and acceptance criteria always go in user.
 */
export function renderForProvider(
	sections: PromptSection[],
	profile: ProviderPromptProfile,
): RenderedPrompt {
	// Sort sections deterministically
	const sorted = [...sections].sort((a, b) => {
		const aIdx = SECTION_ORDER.indexOf(a.kind);
		const bIdx = SECTION_ORDER.indexOf(b.kind);
		if (aIdx !== bIdx) return aIdx - bIdx;
		return a.id.localeCompare(b.id);
	});

	// Separate into system vs user content
	const systemSections = profile.supportsSystemPrompt
		? sorted.filter(
				(s) => s.kind === "project_rules" || s.kind === "tool_permissions",
			)
		: [];

	const userSections = sorted.filter(
		(s) => s.kind !== "tool_permissions" || !profile.supportsSystemPrompt,
	);

	const system = renderSections(systemSections, profile);
	const user = renderSections(userSections, profile);

	return { system, user };
}

function renderSections(
	sections: PromptSection[],
	profile: ProviderPromptProfile,
): string {
	const rendered = sections
		.filter((s) => s.content.trim())
		.map((s) => s.content)
		.join("\n\n---\n\n");

	return formatContent(rendered, profile.preferredInstructionStyle);
}

function formatContent(
	content: string,
	style: ProviderPromptProfile["preferredInstructionStyle"],
): string {
	if (!content.trim()) return "";

	switch (style) {
		case "xml":
			return formatXml(content);
		case "markdown":
			return formatMarkdown(content);
		default:
			return stripMarkdown(content);
	}
}

function formatXml(content: string): string {
	return [
		"<instructions>",
		content
			.split("\n")
			.map((line) => `  ${line}`)
			.join("\n"),
		"</instructions>",
	].join("\n");
}

function formatMarkdown(content: string): string {
	return content;
}

function stripMarkdown(content: string): string {
	return content
		.replace(/^#{1,6}\s+/gm, "") // headers
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
		.replace(/[*_`~]/g, "") // emphasis
		.replace(/^\s*[-*+]\s+/gm, "- ") // list items
		.trim();
}

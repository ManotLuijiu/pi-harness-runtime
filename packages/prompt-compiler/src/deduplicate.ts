/**
 * Prompt Compiler - Deduplication
 *
 * Removes duplicate context entries using normalization.
 * Near-duplicate removal is disabled by default (per RFC-0041).
 */

import type { PromptSection } from "./types.js";

/**
 * Deduplicate sections by removing entries with identical normalized text.
 *
 * Uses the RFC-0041 normalization:
 *   normalize(text) = lowercase(collapseWhitespace(stripMarkdownDecoration(text)))
 *
 * Near-duplicate detection is disabled by default (configurable threshold).
 */
export function deduplicateSections(
	sections: PromptSection[],
	_nearDuplicateThreshold = 0,
): PromptSection[] {
	const seenNormalized = new Set<string>();

	return sections.map((section) => {
		if (!section.compactable) return section;

		// Extract lines that are compactable
		const lines = section.content.split("\n");
		const keptLines: string[] = [];
		const removed: string[] = [];

		for (const line of lines) {
			const normalized = normalizeForDeduplication(line);
			if (normalized === "") {
				// Empty/whitespace lines are always kept
				keptLines.push(line);
			} else if (!seenNormalized.has(normalized)) {
				seenNormalized.add(normalized);
				keptLines.push(line);
			} else {
				removed.push(line);
			}
		}

		if (removed.length > 0) {
			return {
				...section,
				content: keptLines.join("\n"),
			};
		}

		return section;
	});
}

/**
 * Normalize text for deduplication per RFC-0041:
 * - lowercase
 * - collapse whitespace
 * - strip markdown decoration
 */
export function normalizeForDeduplication(text: string): string {
	return collapseWhitespace(stripMarkdownDecoration(text.toLowerCase()));
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function stripMarkdownDecoration(text: string): string {
	return (
		text
			// Remove markdown links BEFORE stripping brackets so [text](url) → "text"
			.replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1") // links → text
			.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1") // images → alt text
			// Strip remaining markdown symbols (brackets, bold, italic, etc.)
			.replace(/[#*_`~>[\]]/g, "")
			// Remove code blocks
			.replace(/```[\s\S]*?```/g, "")
			// Remove inline code backticks
			.replace(/`([^`]+)`/g, "$1")
			.trim()
	);
}

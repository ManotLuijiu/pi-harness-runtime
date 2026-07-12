/**
 * Requirement Compiler - Statement Extractor
 *
 * Extracts and normalizes statements from raw requirement text.
 */

import type {
	ExtractedStatement,
	ExtractionResult,
	RawRequirement,
	SourceReference,
	StatementKind,
} from "./types.js";

/**
 * Split text into sentences, respecting:
 * - Periods followed by space and capital letter
 * - Numbered/bulleted lists
 * - Line breaks
 */
function splitSentences(text: string): string[] {
	// Normalize whitespace
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	// Split on sentence boundaries: . ! ? followed by whitespace + capital or newline
	const sentences = normalized
		.split(/(?<=[.!?])\s+(?=[A-Z\u0E01-\u0E5B])/gm)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return sentences;
}

/**
 * Clean and normalize a statement for comparison.
 */
function normalizeStatement(text: string): string {
	return (
		text
			.toLowerCase()
			// Strip list prefixes: "1. ", "2) ", "• ", "- ", "* "
			.replace(/^[\s]*\d+[.)]\s*/g, "")
			.replace(/^[\s\-•*]+/, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Determine the likely statement kind from its text content.
 */
function inferKind(text: string): StatementKind {
	const lower = text.toLowerCase();

	if (
		lower.includes("prefer") ||
		lower.includes("should") ||
		lower.includes("could")
	) {
		return "preference";
	}
	if (
		lower.includes("must not") ||
		lower.includes("shall not") ||
		lower.includes("cannot")
	) {
		return "constraint";
	}
	if (
		lower.includes("must") ||
		lower.includes("shall") ||
		lower.includes("require")
	) {
		return "explicit_behavior";
	}
	if (lower.includes("assume") || lower.includes("we assume")) {
		return "assumption";
	}
	if (lower.includes("we will") || lower.includes("the system")) {
		return "explicit_behavior";
	}
	return "unknown";
}

/**
 * Extract all statements from raw requirement text.
 */
export function extractStatements(raw: RawRequirement): ExtractionResult {
	const statements: ExtractedStatement[] = [];
	const lines: string[] = [];

	// Split by newlines to preserve structure
	const rawLines = raw.text.split(/\r?\n/).filter((l) => l.trim().length > 0);
	let lineIndex = 0;
	let statementIndex = 0;

	for (const line of rawLines) {
		const trimmedLine = line.trim();
		if (!trimmedLine) continue;

		lines.push(trimmedLine);

		// Check if this is a numbered item or bullet
		const numberedMatch = trimmedLine.match(/^(\d+[.)]\s+)(.*)/);
		const bulletMatch = trimmedLine.match(/^([-•*]\s+)(.*)/);

		let content = trimmedLine;
		let prefix = "";

		if (numberedMatch) {
			prefix = numberedMatch[1];
			content = numberedMatch[2];
		} else if (bulletMatch) {
			prefix = bulletMatch[1];
			content = bulletMatch[2];
		}

		// Further split by sentences within the line
		const sentences = splitSentences(content);
		for (const sentence of sentences) {
			const fullSentence = prefix + sentence;
			const sourceRef: SourceReference = {
				source: raw.source,
				line: lineIndex + 1,
				text: fullSentence,
			};

			const kind = inferKind(fullSentence);

			statements.push({
				id: `stmt-${statementIndex++}`,
				kind,
				originalText: fullSentence,
				normalizedText: normalizeStatement(fullSentence),
				sourceRef,
			});
		}

		lineIndex++;
	}

	// Also extract title as a statement if present
	if (raw.title && raw.title.trim().length > 0) {
		statements.unshift({
			id: "stmt-title",
			kind: "unknown",
			originalText: raw.title.trim(),
			normalizedText: normalizeStatement(raw.title.trim()),
			sourceRef: {
				source: raw.source,
				text: raw.title.trim(),
			},
		});
	}

	return { statements, lines };
}

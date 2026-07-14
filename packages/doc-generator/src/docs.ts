/**
 * Doc Generator — Documentation Generation (RFC-0014)
 */

import type {
	DetectedSymbol,
	GeneratedDocs,
	DocSection,
	SourceFile,
} from "./types.js";
import { detectProjectType } from "./detector.js";

/** Detect exported symbols in a source file. */
export function detectSymbols(source: SourceFile): DetectedSymbol[] {
	const symbols: DetectedSymbol[] = [];
	const lines = source.content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		const fnMatch = trimmed.match(
			/^(?:async\s+)?(?:export\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
		);
		if (fnMatch) {
			symbols.push({
				name: fnMatch[1],
				kind: "function",
				signature: `${fnMatch[1]}(${fnMatch[2]})`,
				docComment: getDocComment(lines, i),
				file: source.path,
				line: i + 1,
			});
		}

		const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
		if (classMatch) {
			symbols.push({
				name: classMatch[1],
				kind: "class",
				docComment: getDocComment(lines, i),
				file: source.path,
				line: i + 1,
			});
		}

		const ifaceMatch = trimmed.match(/^export\s+interface\s+(\w+)/);
		if (ifaceMatch) {
			symbols.push({
				name: ifaceMatch[1],
				kind: "interface",
				docComment: getDocComment(lines, i),
				file: source.path,
				line: i + 1,
			});
		}

		const typeMatch = trimmed.match(/^export\s+type\s+(\w+)/);
		if (typeMatch) {
			symbols.push({
				name: typeMatch[1],
				kind: "type",
				docComment: getDocComment(lines, i),
				file: source.path,
				line: i + 1,
			});
		}

		const constMatch = trimmed.match(/^export\s+const\s+(\w+)/);
		if (constMatch) {
			symbols.push({
				name: constMatch[1],
				kind: "constant",
				docComment: getDocComment(lines, i),
				file: source.path,
				line: i + 1,
			});
		}
	}

	return symbols;
}

function getDocComment(lines: string[], index: number): string | undefined {
	for (let j = Math.max(0, index - 5); j < index; j++) {
		const prev = lines[j].trim();
		if (prev.startsWith("/**") || prev.startsWith("///")) {
			const endIdx = lines
				.slice(j + 1, index)
				.findIndex((l) => l.includes("*/"));
			if (endIdx >= 0) {
				const doc = lines.slice(j, j + endIdx + 2).join("\n");
				return doc.replace(/\/\*\*|\*\/|[\s*]/g, "").trim();
			}
		}
	}
	return undefined;
}

function summarizeSymbols(symbols: DetectedSymbol[]): string {
	const counts: Record<string, number> = {};
	for (const s of symbols) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
	return Object.entries(counts)
		.map(([k, v]) => `${v} ${k}(s)`)
		.join(", ");
}

function formatSymbol(s: DetectedSymbol): string {
	const sig = s.signature ? `${s.name}${s.signature}` : s.name;
	return `- ${sig} (${s.file}:${s.line})`;
}

/** Generate documentation for a list of source files. */
export function generateDocs(
	sources: SourceFile[],
	projectSignals: string[],
): GeneratedDocs {
	const detection = detectProjectType(projectSignals);
	const allSymbols = sources.flatMap(detectSymbols);

	const sections: DocSection[] = [
		{
			heading: "Overview",
			level: 1,
			content: `Project type: ${detection.projectType} (confidence: ${(detection.confidence * 100).toFixed(0)}%)\nSignals: ${detection.signals.join(", ") || "none"}`,
		},
		{
			heading: "Exports",
			level: 1,
			content: `Total exports: ${allSymbols.length}\n${summarizeSymbols(allSymbols)}`,
		},
		{
			heading: "Functions",
			level: 2,
			content:
				allSymbols
					.filter((s) => s.kind === "function")
					.map(formatSymbol)
					.join("\n") || "No functions found.",
		},
		{
			heading: "Types & Interfaces",
			level: 2,
			content:
				allSymbols
					.filter((s) => s.kind === "type" || s.kind === "interface")
					.map(formatSymbol)
					.join("\n") || "No types found.",
		},
	];

	return {
		title: "Generated Documentation",
		sections,
		symbols: allSymbols,
		projectType: detection.projectType,
	};
}

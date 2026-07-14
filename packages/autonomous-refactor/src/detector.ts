/**
 * Autonomous Refactor — Pattern Detection (RFC-0092)
 */

import type { RefactorFinding, RiskLevel } from "./types.js";

let findingCounter = 0;

export function detectRefactorings(
	files: Array<{ path: string; content: string }>,
): RefactorFinding[] {
	const findings: RefactorFinding[] = [];

	for (const file of files) {
		findings.push(...detectMagicLiterals(file));
		findings.push(...detectLongFunctions(file));
		findings.push(...detectNestedConditionals(file));
		findings.push(...detectUnusedVariables(file));
	}

	return findings.sort((a, b) => b.confidence - a.confidence);
}

function detectMagicLiterals(file: {
	path: string;
	content: string;
}): RefactorFinding[] {
	const findings: RefactorFinding[] = [];
	const lines = file.content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.includes("//") || line.includes("/*")) continue;

		const magicMatch = line.match(/\b([2-9]|[1-9]\d+)\b/g);
		if (magicMatch && magicMatch.length > 0) {
			findings.push({
				id: `ref-${++findingCounter}-${Date.now()}`,
				type: "replace-magic-literal",
				file: file.path,
				location: { line: i + 1, column: line.search(/\d/) + 1 },
				description: `Magic number "${magicMatch[0]}" found`,
				risk: "low",
				confidence: 0.75,
				rationale: [
					"Magic numbers reduce readability",
					"Named constants are self-documenting",
				],
			});
		}

		const strMatch = line.match(/'([^']{4,})'/g) || line.match(/"([^"]{4,})"/g);
		if (strMatch && !strMatch.some((m) => m.toLowerCase().includes("url"))) {
			findings.push({
				id: `ref-${++findingCounter}-${Date.now()}`,
				type: "replace-magic-literal",
				file: file.path,
				location: { line: i + 1, column: line.indexOf(strMatch[0]) + 1 },
				description: `Magic string literal found`,
				risk: "low",
				confidence: 0.6,
				rationale: ["String literals without context reduce clarity"],
			});
		}
	}

	return findings.slice(0, 5);
}

function detectLongFunctions(file: {
	path: string;
	content: string;
}): RefactorFinding[] {
	const findings: RefactorFinding[] = [];
	const lines = file.content.split("\n");
	const THRESHOLD = 30;
	let braceDepth = 0;
	let funcStart = -1;
	// foundFunc removed, use funcStart < 0 as sentinel
	let funcName = "anonymous";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		braceDepth += (line.match(/\{/g) || []).length;
		braceDepth -= (line.match(/\}/g) || []).length;

		const funcMatch = line.match(
			/(?:function\s+(\w+)|const\s+(\w+)\s*=|(\w+)\s*\([^)]*\)\s*\{)/,
		);
		// Only capture function start once — avoid re-matching const/arrow as functions
		if (funcMatch && funcStart < 0) {
			funcStart = i;
			funcName = funcMatch[1] ?? funcMatch[2] ?? funcMatch[3] ?? "anonymous";
		}

		if (funcStart >= 0 && braceDepth === 0) {
			const funcLength = i - funcStart + 1;
			if (funcLength > THRESHOLD) {
				findings.push({
					id: `ref-${++findingCounter}-${Date.now()}`,
					type: "extract-method",
					file: file.path,
					location: { line: funcStart + 1, column: 1 },
					description: `Function "${funcName}" is ${funcLength} lines (threshold: ${THRESHOLD})`,
					risk: "medium",
					confidence: 0.7,
					rationale: [
						"Long functions are harder to test",
						"Splitting improves single responsibility",
						`Current length: ${funcLength} lines`,
					],
				});
			}
			funcStart = -1;
		}
	}

	return findings;
}

function detectNestedConditionals(file: {
	path: string;
	content: string;
}): RefactorFinding[] {
	const findings: RefactorFinding[] = [];
	const lines = file.content.split("\n");
	let maxDepth = 0;
	let currentDepth = 0;
	let maxLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (
			line.startsWith("if") ||
			line.startsWith("else if") ||
			line.includes("?")
		) {
			currentDepth++;
			if (currentDepth > maxDepth) {
				maxDepth = currentDepth;
				maxLine = i + 1;
			}
		}
		if (line === "}" && currentDepth > 0) currentDepth--;
	}

	if (maxDepth > 3) {
		findings.push({
			id: `ref-${++findingCounter}-${Date.now()}`,
			type: "simplify-conditional",
			file: file.path,
			location: { line: maxLine, column: 1 },
			description: `${maxDepth} levels of nested conditionals detected`,
			risk: "medium",
			confidence: 0.65,
			rationale: [
				"Deep nesting reduces readability",
				"Consider early returns or polymorphism",
			],
		});
	}

	return findings;
}

function detectUnusedVariables(file: {
	path: string;
	content: string;
}): RefactorFinding[] {
	const findings: RefactorFinding[] = [];
	const lines = file.content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const declMatch = line.match(/^\s*(const|let|var)\s+([a-zA-Z_]\w*)\s*=/);
		if (!declMatch) continue;

		const varName = declMatch[2];
		const afterDecl = lines.slice(i + 1).join("\n");

		// Count by splitting instead of regex to avoid ReDoS
		const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(`\\b${escaped}\\b`, "g");
		const occurrences = (afterDecl.match(pattern) || []).length;

		if (occurrences === 0 && !varName.startsWith("_")) {
			findings.push({
				id: `ref-${++findingCounter}-${Date.now()}`,
				type: "rename-variable",
				file: file.path,
				location: { line: i + 1, column: line.indexOf(varName) + 1 },
				description: `Variable "${varName}" appears unused after declaration`,
				risk: "low",
				confidence: 0.6,
				rationale: ["Unused variables add noise", "Remove or use the variable"],
			});
		}
	}

	return findings;
}

export function assessRisk(finding: RefactorFinding): RiskLevel {
	return finding.risk;
}

export function calculatePriority(finding: RefactorFinding): number {
	const confidenceWeight = 0.4;
	const riskWeight: Record<RiskLevel, number> = {
		low: 0.2,
		medium: 0.4,
		high: 0.7,
		critical: 1.0,
	};
	return (
		finding.confidence * confidenceWeight +
		(1 - finding.confidence) * riskWeight[finding.risk]
	);
}

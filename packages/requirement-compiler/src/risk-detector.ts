/**
 * Requirement Compiler - Risk Detector
 *
 * Detects financial, privacy, regulatory, and other risk areas.
 */

import {
	type ClassificationResult,
	DEFAULT_COMPILER_CONFIG,
	type RequirementRisk,
	type RiskTag,
} from "./types.js";

/**
 * Detect risk tags based on keyword matching.
 */
export function detectRisks(classification: ClassificationResult): RiskTag[] {
	const riskTags: RiskTag[] = [];
	const riskKeywords = DEFAULT_COMPILER_CONFIG.riskKeywords ?? {};

	const allStatements = [
		...classification.goals,
		...classification.constraints,
		...classification.preferences,
		...classification.implementationSuggestions,
		// Also scan unknown and terminology statements so Thai/English regulatory
		// and financial keywords trigger risk tags even when classification
		// is uncertain (e.g. Thai-only text classified as terminology)
		...classification.unknown,
		...classification.terminologyMentions,
	];

	const seen = new Set<string>();

	for (const stmt of allStatements) {
		const lower = stmt.normalizedText;

		for (const [riskType, keywords] of Object.entries(riskKeywords)) {
			if (!keywords) continue;
			for (const keyword of keywords) {
				if (lower.includes(keyword.toLowerCase())) {
					const tagId = `${riskType}-${stmt.id}`;
					if (!seen.has(tagId)) {
						seen.add(tagId);
						riskTags.push({
							risk: riskType as RequirementRisk,
							affectedId: stmt.id,
							description: `Risk area detected: "${keyword}" in statement "${stmt.originalText.slice(0, 60)}..."`,
						});
					}
					break;
				}
			}
		}
	}

	return riskTags;
}

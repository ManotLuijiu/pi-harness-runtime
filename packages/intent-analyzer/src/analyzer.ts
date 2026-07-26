/**
 * Intent Analyzer — Analyzer
 *
 * Keyword-based intent detection.
 */

import type { Intent, IntentConfidence, IntentKind, IntentRule, IntentSignal } from "./types.js";

const INTENT_RULES: IntentRule[] = [
	{ kind: "bug_fix",     keywords: ["fix", "bug", "error", "crash", "fail", "broken", "issue", "defect", "patch", "hotfix"], weight: 2, confidence: "high" },
	{ kind: "feature",     keywords: ["add", "implement", "new", "create", "build", "introduce"], weight: 2, confidence: "high" },
	{ kind: "refactor",    keywords: ["refactor", "rename", "move", "extract", "restructure", "cleanup", "simplify", "rewrite"], weight: 2, confidence: "high" },
	{ kind: "code_review", keywords: ["review", "check code", "audit", "critique", "evaluate", "assess"], weight: 2, confidence: "high" },
	{ kind: "deployment",  keywords: ["deploy", "release", "publish", "ship", "launch", "rollout", "promote"], weight: 2, confidence: "high" },
	{ kind: "testing",     keywords: ["test", "spec", "coverage", "unit test", "integration test", "e2e", "specify"], weight: 2, confidence: "high" },
	{ kind: "documentation", keywords: ["doc", "readme", "comment", "document", "guide", "changelog", "spec"], weight: 1, confidence: "medium" },
	{ kind: "migration",  keywords: ["migrate", "convert", "port", "upgrade", "move to", "transition"], weight: 2, confidence: "high" },
	{ kind: "security",    keywords: ["security", "vulnerability", "exploit", "auth", "permission", "cve", "secret", "token"], weight: 2, confidence: "high" },
	{ kind: "performance", keywords: ["performance", "speed", "optimize", "fast", "slow", "latency", "benchmark"], weight: 2, confidence: "high" },
	{ kind: "architecture", keywords: ["architecture", "design", "structure", "system design", "pattern", "abstraction", "component"], weight: 2, confidence: "medium" },
	{ kind: "research",    keywords: ["research", "investigate", "explore", "analyze", "study", "understand"], weight: 1, confidence: "medium" },
	{ kind: "learning",    keywords: ["learn", "teach", "explain", "how does", "understand", "what is"], weight: 1, confidence: "low" },
];

function tokenize(text: string): string[] {
	return text.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

export class IntentAnalyzer {
	private rules: IntentRule[];

	constructor(rules: IntentRule[] = INTENT_RULES) {
		this.rules = rules;
	}

	analyze(text: string): Intent {
		const lower = text.toLowerCase();
		const tokens = tokenize(text);

		const matchedSignals: IntentSignal[] = [];
		let topKind: IntentKind = "general";
		let topScore = 0;
		let topConfidence: IntentConfidence = "low";

		for (const rule of this.rules) {
			let ruleScore = 0;
			const matchedKeywords: string[] = [];

			for (const keyword of rule.keywords) {
				if (lower.includes(keyword)) {
					ruleScore += rule.weight;
					matchedKeywords.push(keyword);
				}
			}

			if (ruleScore > topScore) {
				topScore = ruleScore;
				topKind = rule.kind;
				topConfidence = rule.confidence;
			}

			for (const kw of matchedKeywords) {
				matchedSignals.push({ keyword: kw, weight: rule.weight, matched: true });
			}
		}

		if (topScore === 0) {
			topKind = "general";
			topConfidence = "low";
		}

		return {
			kind: topKind,
			confidence: topConfidence,
			signals: matchedSignals,
			originalText: text,
		};
	}

	analyzeBatch(texts: string[]): Intent[] {
		return texts.map((t) => this.analyze(t));
	}
}

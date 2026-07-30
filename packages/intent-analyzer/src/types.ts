/**
 * Intent Analyzer — Types
 *
 * Determines what the user is actually trying to accomplish.
 */

export type IntentKind =
	| "bug_fix"
	| "feature"
	| "architecture"
	| "refactor"
	| "code_review"
	| "documentation"
	| "testing"
	| "deployment"
	| "research"
	| "learning"
	| "migration"
	| "security"
	| "performance"
	| "general";

export type IntentConfidence = "high" | "medium" | "low";

export interface IntentSignal {
	keyword: string;
	weight: number;
	matched: boolean;
}

export interface Intent {
	kind: IntentKind;
	confidence: IntentConfidence;
	signals: IntentSignal[];
	originalText: string;
	derivedTask?: string;
}

export interface IntentRule {
	kind: IntentKind;
	keywords: string[];
	weight: number;
	confidence: IntentConfidence;
}

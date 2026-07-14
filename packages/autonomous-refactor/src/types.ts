/**
 * Autonomous Refactor — Types (RFC-0092)
 */

export type RefactorType =
	| "extract-method"
	| "inline-method"
	| "rename-variable"
	| "move-function"
	| "extract-interface"
	| "replace-loop-pipeline"
	| "introduce-null-object"
	| "extract-superclass"
	| "simplify-conditional"
	| "replace-magic-literal";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RefactorFinding {
	id: string;
	type: RefactorType;
	file: string;
	location: { line: number; column: number };
	description: string;
	risk: RiskLevel;
	confidence: number;
	suggestedFix?: string;
	rationale?: string[];
}

export interface RefactorPlan {
	id: string;
	findings: RefactorFinding[];
	priorityOrder: string[];
	estimatedImpact: {
		complexityReduction: number;
		maintainabilityImprovement: number;
		riskExposure: number;
	};
	blockers: string[];
}

export interface RefactorConfig {
	maxFindings: number;
	riskThreshold: RiskLevel;
	autoApply: boolean;
	requireReviewAbove: RiskLevel;
	preserveBehavior: boolean;
}

export const DEFAULT_CONFIG: Required<RefactorConfig> = {
	maxFindings: 50,
	riskThreshold: "medium",
	autoApply: false,
	requireReviewAbove: "high",
	preserveBehavior: true,
};

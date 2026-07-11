/**
 * Requirement Compiler - Types
 *
 * Type definitions for raw and compiled requirements.
 */

// ─── SDK Version ────────────────────────────────────────────────────────────

export const SDK_VERSION = "1.0.0";

// ─── Source Reference ─────────────────────────────────────────────────────

/**
 * Reference to a source location in the original requirement.
 */
export interface SourceReference {
	/** Source file or input identifier */
	source: string;
	/** Line number (1-based) */
	line?: number;
	/** Character offset within the line */
	startChar?: number;
	/** Character offset of the end */
	endChar?: number;
	/** The referenced text */
	text: string;
}

// ─── Attachment ────────────────────────────────────────────────────────────

/**
 * Reference to an attached file (screenshot, document, etc.).
 */
export interface AttachmentReference {
	/** Attachment identifier */
	id: string;
	/** Attachment type */
	type: "screenshot" | "document" | "spreadsheet" | "image" | "other";
	/** File path or URL */
	path: string;
	/** Optional description */
	description?: string;
}

// ─── Raw Requirement (Input) ─────────────────────────────────────────────

/**
 * Raw requirement as submitted by a user or received from an API.
 */
export interface RawRequirement {
	/** Unique requirement identifier */
	id: string;
	/** Optional short title */
	title?: string;
	/** Primary requirement text (prose) */
	text: string;
	/** Optional attachments */
	attachments?: AttachmentReference[];
	/** Source channel */
	source: "tui" | "file" | "api";
	/** User who submitted the requirement */
	submittedBy: string;
	/** ISO timestamp of submission */
	submittedAt: string;
}

// ─── Statement Types ──────────────────────────────────────────────────────

/**
 * Kinds of statements extracted from raw requirement text.
 */
export type StatementKind =
	/** Explicit behavior the system must perform */
	| "explicit_behavior"
	/** Explicit behavior the system must NOT perform */
	| "constraint"
	/** User's stated goal or objective */
	| "goal"
	/** Something assumed to be true (not proven) */
	| "assumption"
	/** Preference, suggestion, or "nice-to-have" */
	| "preference"
	/** Implementation suggestion (not a requirement) */
	| "implementation_suggestion"
	/** Domain term that should be preserved */
	| "terminology"
	/** Actor or user role mentioned */
	| "actor_mention"
	/** Acceptance criterion statement */
	| "acceptance_criterion"
	/** Unknown or unclassified */
	| "unknown";

/**
 * An extracted statement from the raw requirement text.
 */
export interface ExtractedStatement {
	/** Unique statement identifier */
	id: string;
	/** Statement category */
	kind: StatementKind;
	/** Original text as written */
	originalText: string;
	/** Normalized/cleaned text */
	normalizedText: string;
	/** Source reference */
	sourceRef: SourceReference;
	/** Whether this statement was explicitly marked mandatory by the user */
	userMarkedMandatory?: boolean;
}

// ─── Goals ────────────────────────────────────────────────────────────────

/**
 * A goal extracted from the requirement.
 */
export interface RequirementGoal {
	/** Goal identifier */
	id: string;
	/** Human-readable description */
	description: string;
	/** Source statements that contributed to this goal */
	sourceRefs: SourceReference[];
	/** Priority if explicitly stated */
	priority?: "high" | "medium" | "low";
}

// ─── Constraints ──────────────────────────────────────────────────────────

/**
 * A constraint that the solution must satisfy.
 */
export type ConstraintKind = "mandatory" | "preferable";

export interface RequirementConstraint {
	/** Constraint identifier */
	id: string;
	/** Constraint text */
	description: string;
	/** Constraint kind */
	kind: ConstraintKind;
	/** Source statements */
	sourceRefs: SourceReference[];
	/** Whether this constraint is blocking */
	blocking: boolean;
}

// ─── Actors ───────────────────────────────────────────────────────────────

/**
 * An actor (user role, system, service) identified in the requirement.
 */
export interface RequirementActor {
	/** Actor identifier */
	id: string;
	/** Actor name */
	name: string;
	/** Actor role description */
	role: string;
	/** Source statements */
	sourceRefs: SourceReference[];
}

// ─── Workflows ────────────────────────────────────────────────────────────

/**
 * A workflow or use case described in the requirement.
 */
export interface RequirementWorkflow {
	/** Workflow identifier */
	id: string;
	/** Workflow name */
	name: string;
	/** Step-by-step description */
	steps: string[];
	/** Actors involved */
	actors: string[];
	/** Preconditions */
	preconditions: string[];
	/** Expected outcomes */
	outcomes: string[];
	/** Source statements */
	sourceRefs: SourceReference[];
}

// ─── Acceptance Criteria ─────────────────────────────────────────────────

/**
 * Normalized acceptance criterion using Given/When/Then format.
 */
export interface AcceptanceCriterion {
	/** Criterion identifier */
	id: string;
	/** Given clause - preconditions */
	given: string;
	/** When clause - trigger */
	when: string;
	/** Then clauses - expected outcomes (renamed to avoid Promise.then collision) */
	outcome: string[];
	/** Source statements */
	sourceRefs: SourceReference[];
	/** Whether this can be automated by a test */
	automatable: boolean;
	/** Original text before normalization */
	originalText?: string;
}

// ─── Ambiguities ──────────────────────────────────────────────────────────

/**
 * An ambiguous area in the requirement that needs clarification.
 */
export interface RequirementAmbiguity {
	/** Ambiguity identifier */
	id: string;
	/** Question that clarifies the ambiguity */
	question: string;
	/** Whether this ambiguity blocks implementation */
	blocking: boolean;
	/** Which goals are affected */
	affectedGoals: string[];
	/** Evidence for the ambiguity */
	evidence: SourceReference[];
	/** Category of ambiguity */
	category:
		| "missing_value"
		| "missing_actor"
		| "contradiction"
		| "vague_term"
		| "scope_unclear"
		| "unknown";
}

// ─── Assumptions ─────────────────────────────────────────────────────────

/**
 * An assumption that was made to fill a gap.
 */
export interface RequirementAssumption {
	/** Assumption identifier */
	id: string;
	/** Description of the assumption */
	description: string;
	/** Source statements */
	sourceRefs: SourceReference[];
	/** Whether this assumption can be reversed */
	reversible: boolean;
}

// ─── Terminology ───────────────────────────────────────────────────────────

/**
 * Domain terminology mapping.
 */
export interface TerminologyEntry {
	/** Term as used in requirement */
	term: string;
	/** Definition or explanation */
	definition: string;
	/** Original language (for multilingual preservation) */
	language: string;
	/** Source reference */
	sourceRef?: SourceReference;
}

// ─── Risk Tags ────────────────────────────────────────────────────────────

/**
 * Risk areas that require additional review.
 */
export type RequirementRisk =
	| "financial"
	| "privacy"
	| "authentication"
	| "authorization"
	| "data_migration"
	| "regulatory"
	| "destructive_operation";

/**
 * Risk tag attached to a goal or constraint.
 */
export interface RiskTag {
	/** Risk type */
	risk: RequirementRisk;
	/** Which item is affected */
	affectedId: string;
	/** Explanation of the risk */
	description: string;
}

// ─── Compilation Status ───────────────────────────────────────────────────

/**
 * Status of a compiled requirement.
 */
export type RequirementStatus =
	/** Ready for task compilation */
	| "ready"
	/** Needs human clarification before proceeding */
	| "needs_human"
	/** Rejected (empty, impossible, or policy violation) */
	| "rejected";

// ─── Compiled Requirement (Output) ────────────────────────────────────────

/**
 * Fully compiled requirement with validated structure.
 */
export interface CompiledRequirement {
	/** Requirement identifier */
	id: string;
	/** Short title */
	title: string;
	/** Problem statement being addressed */
	problemStatement: string;
	/** Goals extracted from the requirement */
	goals: RequirementGoal[];
	/** Explicit non-goals */
	nonGoals: string[];
	/** Constraints the solution must satisfy */
	constraints: RequirementConstraint[];
	/** Actors identified in the requirement */
	actors: RequirementActor[];
	/** Workflows/use cases described */
	workflows: RequirementWorkflow[];
	/** Normalized acceptance criteria */
	acceptanceCriteria: AcceptanceCriterion[];
	/** Assumptions made to fill gaps */
	assumptions: RequirementAssumption[];
	/** Identified ambiguities */
	ambiguities: RequirementAmbiguity[];
	/** Domain terminology glossary */
	terminology: TerminologyEntry[];
	/** Risk tags for compliance */
	riskTags: RiskTag[];
	/** Source references */
	sourceRefs: SourceReference[];
	/** Compilation status */
	status: RequirementStatus;
	/** Rejection reason if status is 'rejected' */
	rejectionReason?: string;
	/** ISO timestamp of compilation */
	compiledAt: string;
}

// ─── Extraction Result ────────────────────────────────────────────────────

/**
 * Result of statement extraction from raw text.
 */
export interface ExtractionResult {
	/** Extracted statements */
	statements: ExtractedStatement[];
	/** Raw extracted text grouped by line */
	lines: string[];
}

// ─── Classification Result ─────────────────────────────────────────────────

/**
 * Result of statement classification.
 */
export interface ClassificationResult {
	/** Classified statements */
	statements: ExtractedStatement[];
	/** Goals identified */
	goals: ExtractedStatement[];
	/** Constraints identified */
	constraints: ExtractedStatement[];
	/** Preferences identified */
	preferences: ExtractedStatement[];
	/** Implementation suggestions */
	implementationSuggestions: ExtractedStatement[];
	/** Terminology mentions */
	terminologyMentions: ExtractedStatement[];
	/** Actor mentions */
	actorMentions: ExtractedStatement[];
	/** Acceptance criteria statements */
	acceptanceCriterionStatements: ExtractedStatement[];
	/** Assumptions identified */
	assumptions: ExtractedStatement[];
	/** Unknown statements */
	unknown: ExtractedStatement[];
}

// ─── Compiler Configuration ────────────────────────────────────────────────

/**
 * Configuration for the Requirement Compiler.
 */
export interface RequirementCompilerConfig {
	/**
	 * Project language for terminology normalization.
	 * Defaults to English.
	 */
	projectLanguage?: "en" | "th" | "mixed";
	/**
	 * Whether to auto-promote preferences to constraints.
	 * Defaults to false (preferences stay non-blocking).
	 */
	autoPromotePreferences?: boolean;
	/**
	 * Whether to allow ambiguity resolution via assumption.
	 * Defaults to true.
	 */
	allowReversibleAssumptions?: boolean;
	/**
	 * Risk keywords to detect per risk type.
	 * Merged with default detection.
	 */
	riskKeywords?: Partial<Record<RequirementRisk, string[]>>;
	/**
	 * Keywords that indicate a statement is mandatory.
	 */
	mandatoryKeywords?: string[];
	/**
	 * Keywords that indicate a statement is a preference.
	 */
	preferenceKeywords?: string[];
}

export const DEFAULT_COMPILER_CONFIG: RequirementCompilerConfig = {
	projectLanguage: "en",
	autoPromotePreferences: false,
	allowReversibleAssumptions: true,
	riskKeywords: {
		financial: [
			"payment",
			"cost",
			"price",
			"fee",
			"charge",
			"invoice",
			"tax",
			"VAT",
			"value added tax",
			"ภาษี",
			"ภาษีมูลค่าเพิ่ม",
			"เงิน",
			"บาท",
		],
		privacy: [
			"personal",
			"data",
			"privacy",
			"GDPR",
			"PDPA",
			"consent",
			"ข้อมูลส่วนบุคคล",
			"consent",
		],
		authentication: [
			"auth",
			"login",
			"password",
			"token",
			"JWT",
			"OAuth",
			"session",
			"เข้าสู่ระบบ",
		],
		authorization: [
			"permission",
			"role",
			"access control",
			"ACL",
			"authorize",
			"สิทธิ์",
		],
		data_migration: [
			"migration",
			"import",
			"export",
			"convert",
			"migrate",
			"ย้ายข้อมูล",
		],
		regulatory: [
			"compliance",
			"regulation",
			"audit",
			"log",
			"report",
			"กฎหมาย",
			"ระเบียบ",
		],
		destructive_operation: [
			"delete",
			"drop",
			"truncate",
			"remove",
			"purge",
			"destroy",
			"ลบ",
		],
	},
	mandatoryKeywords: [
		"must",
		"shall",
		"required",
		"need to",
		"have to",
		"จะต้อง",
		"ต้อง",
		"required",
	],
	preferenceKeywords: [
		"prefer",
		"should",
		"could",
		"might",
		"suggest",
		"recommend",
		"nice to have",
		"ควร",
	],
};

// ─── Compiler Dependencies ─────────────────────────────────────────────────

/**
 * Dependencies injected into the compiler.
 * Allows swapping extraction, classification, and validation logic.
 */
export interface RequirementCompilerDependencies {
	/** Optional custom statement extractor */
	extractor?: StatementExtractor;
	/** Optional custom classifier */
	classifier?: StatementClassifier;
	/** Optional custom ambiguity detector */
	ambiguityDetector?: AmbiguityDetector;
	/** Optional custom risk detector */
	riskDetector?: RiskDetector;
	/** Optional custom normalizer for acceptance criteria */
	acceptanceNormalizer?: AcceptanceNormalizer;
	/** Clock function for timestamps */
	clock?: () => Date;
}

export interface StatementExtractor {
	extract(raw: RawRequirement): ExtractionResult;
}

export interface StatementClassifier {
	classify(
		statements: ExtractedStatement[],
		config: RequirementCompilerConfig,
	): ClassificationResult;
}

export interface AmbiguityDetector {
	detect(
		classification: ClassificationResult,
		config: RequirementCompilerConfig,
	): RequirementAmbiguity[];
}

export interface RiskDetector {
	detect(classification: ClassificationResult): RiskTag[];
}

export interface AcceptanceNormalizer {
	normalize(statements: ExtractedStatement[]): AcceptanceCriterion[];
}

// ─── Compiler Errors ──────────────────────────────────────────────────────

/**
 * Error codes for requirement compilation failures.
 * Use this enum-like object for programmatic error checking.
 */
export const RequirementCompileErrorCodes = {
	EMPTY_REQUIREMENT: "EMPTY_REQUIREMENT",
	IMPOSSIBLE_REQUIREMENT: "IMPOSSIBLE_REQUIREMENT",
	POLICY_VIOLATION: "POLICY_VIOLATION",
	UNSUPPORTED_ATTACHMENT: "UNSUPPORTED_ATTACHMENT",
	UNRESOLVABLE_CONTRADICTION: "UNRESOLVABLE_CONTRADICTION",
} as const;

export type RequirementCompileErrorCode =
	(typeof RequirementCompileErrorCodes)[keyof typeof RequirementCompileErrorCodes];

/**
 * Error thrown during requirement compilation.
 */
export class RequirementCompileError extends Error {
	constructor(
		public readonly code: RequirementCompileErrorCode,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "RequirementCompileError";
	}
}

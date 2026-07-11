/**
 * Task Compiler - Type Definitions
 *
 * Core types for task decomposition, DAG construction, and verification.
 */

// ─── SDK Version ───────────────────────────────────────────────────────

export const SDK_VERSION = "1.0.0" as const;

// ─── Task Types ────────────────────────────────────────────────────────

export type TaskType =
	| "analysis"
	| "design"
	| "implementation"
	| "test"
	| "e2e_test"
	| "review"
	| "repair"
	| "documentation";

export type ComplexityEstimate = 1 | 2 | 3 | 5 | 8;

// ─── Task Output ────────────────────────────────────────────────────────

export interface TaskOutput {
	kind: "file" | "test_result" | "report" | "schema" | "diff" | "verification";
	path?: string;
	description: string;
	required: boolean;
}

// ─── Compiled Task ─────────────────────────────────────────────────────

export interface CompiledTask {
	id: string;
	jobId: string;
	title: string;
	objective: string;
	type: TaskType;
	dependencies: string[];
	filesInScope: string[];
	filesExclude?: string[];
	expectedOutputs: TaskOutput[];
	acceptanceCriteria: string[];
	requiredCapabilities: string[];
	permittedCommands: string[];
	prohibitedCommands: string[];
	preferredProvider?: string;
	estimatedComplexity: ComplexityEstimate;
	fileOwnership: FileOwnership;
	priority?: number;
}

// ─── File Ownership ────────────────────────────────────────────────────

export type FileOwnershipMode = "exclusive" | "shared_read";

export interface FileOwnership {
	taskId: string;
	include: string[];
	exclude: string[];
	mode: FileOwnershipMode;
}

// ─── Task Graph ────────────────────────────────────────────────────────

export interface TaskGraph {
	jobId: string;
	tasks: CompiledTask[];
	roots: string[];
	terminalTasks: string[];
	topologicalOrder: string[];
}

// ─── Standard Engineering Flow ────────────────────────────────────────

export const STANDARD_FLOW: TaskType[] = [
	"analysis",
	"design",
	"implementation",
	"test",
	"e2e_test",
	"review",
	"repair",
	"documentation",
];

// ─── Provider Hints ───────────────────────────────────────────────────

export const PROVIDER_HINTS: Partial<Record<TaskType, string[]>> = {
	analysis: ["codex", "gpt", "glm"],
	design: ["codex", "gpt", "glm"],
	implementation: ["minimax", "claude", "glm"],
	test: ["minimax", "claude"],
	e2e_test: ["playwright"],
	review: ["claude", "glm"],
	repair: ["glm", "claude"],
	documentation: ["codex", "gpt"],
};

// ─── Default Command Policy ─────────────────────────────────────────────

export const PROHIBITED_BY_DEFAULT: string[] = [
	"git commit",
	"git push",
	"bench build",
	"bench migrate",
	"bench install-app",
	"bench restart",
	"npm run build",
	"yarn build",
	"pnpm build",
	"python manage.py migrate",
	"docker compose up",
	"docker compose down",
	"rm -rf",
	"DROP DATABASE",
	"TRUNCATE",
];

// ─── Forward-declared types (from other workspace packages) ─────────────
// In production these are imported from @pi/requirement-compiler and @pi/project-analyzer.
// Declaring them as interfaces here allows the type checker to resolve without building those packages first.

export interface CompiledRequirement {
	id: string;
	title: string;
	problemStatement: string;
	goals: Array<{ id: string; description: string }>;
	constraints: Array<{ id: string; description: string; blocking: boolean }>;
	nonGoals?: string[];
	acceptanceCriteria: Array<{ id: string; outcome: string[] }>;
	riskTags: Array<{ risk: string; affectedId: string }>;
}

export interface ProjectProfile {
	projectPath: string;
	projectName?: string;
	frameworks?: Array<{ name: string; confidence: number }>;
	testCapabilities?: Array<{ runner: string; supported: boolean }>;
	commands?: Record<string, string>;
	rules?: Array<{
		id: string;
		section: string;
		permittedCommands?: string[];
		prohibitedCommands?: string[];
	}>;
}

// ─── Compiler Input ────────────────────────────────────────────────────

export interface TaskCompileInput {
	requirement: CompiledRequirement;
	project: ProjectProfile;
	dependencies?: DependencyInfo[];
	jobId: string;
	clock?: () => Date;
	insertE2E?: boolean;
	maxComplexity?: ComplexityEstimate;
}

export interface DependencyInfo {
	requirementId: string;
	dependsOn: string[];
	files: string[];
}

// ─── Candidate Task ───────────────────────────────────────────────────

export interface TaskCandidate {
	id: string;
	title: string;
	objective: string;
	type: TaskType;
	roughDependencies: string[];
	criteria: string[];
	estimatedComplexity: ComplexityEstimate;
	priority?: number;
}

// ─── Compiler Configuration ──────────────────────────────────────────────

export interface TaskCompilerConfig {
	insertE2E: boolean;
	maxComplexity: ComplexityEstimate;
	extraProhibitedCommands: string[];
	clock: () => Date;
}

export const DEFAULT_TASK_COMPILER_CONFIG: TaskCompilerConfig = {
	insertE2E: true,
	maxComplexity: 5,
	extraProhibitedCommands: [],
	clock: () => new Date(),
};

// ─── Compiler Errors ─────────────────────────────────────────────────────

export enum TaskCompilerErrorCode {
	CYCLIC_DEPENDENCY = "CYCLIC_DEPENDENCY",
	EMPTY_OBJECTIVE = "EMPTY_OBJECTIVE",
	NO_VERIFICATION = "NO_VERIFICATION",
	FILE_OVERLAP_CONFLICT = "FILE_OVERLAP_CONFLICT",
	UNSATISFIED_CRITERION = "UNSATISFIED_CRITERION",
	MISSING_CAPABILITY = "MISSING_CAPILITY",
	DESTRUCTIVE_COMMAND_APPROVAL = "DESTRUCTIVE_COMMAND_APPROVAL",
}

export class TaskCompilerError extends Error {
	readonly code: TaskCompilerErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: TaskCompilerErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "TaskCompilerError";
		this.code = code;
		this.details = details;
	}
}

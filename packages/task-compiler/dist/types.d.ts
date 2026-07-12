/**
 * Task Compiler - Type Definitions
 *
 * Core types for task decomposition, DAG construction, and verification.
 */
export declare const SDK_VERSION: "1.0.0";
export type TaskType = "analysis" | "design" | "implementation" | "test" | "e2e_test" | "review" | "repair" | "documentation";
export type ComplexityEstimate = 1 | 2 | 3 | 5 | 8;
export interface TaskOutput {
    kind: "file" | "test_result" | "report" | "schema" | "diff" | "verification";
    path?: string;
    description: string;
    required: boolean;
}
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
export type FileOwnershipMode = "exclusive" | "shared_read";
export interface FileOwnership {
    taskId: string;
    include: string[];
    exclude: string[];
    mode: FileOwnershipMode;
}
export interface TaskGraph {
    jobId: string;
    tasks: CompiledTask[];
    roots: string[];
    terminalTasks: string[];
    topologicalOrder: string[];
}
export declare const STANDARD_FLOW: TaskType[];
export declare const PROVIDER_HINTS: Partial<Record<TaskType, string[]>>;
export declare const PROHIBITED_BY_DEFAULT: string[];
export interface CompiledRequirement {
    id: string;
    title: string;
    problemStatement: string;
    goals: Array<{
        id: string;
        description: string;
    }>;
    constraints: Array<{
        id: string;
        description: string;
        blocking: boolean;
    }>;
    nonGoals?: string[];
    acceptanceCriteria: Array<{
        id: string;
        outcome: string[];
    }>;
    riskTags: Array<{
        risk: string;
        affectedId: string;
    }>;
}
export interface ProjectProfile {
    projectPath: string;
    projectName?: string;
    frameworks?: Array<{
        name: string;
        confidence: number;
    }>;
    testCapabilities?: Array<{
        runner: string;
        supported: boolean;
    }>;
    commands?: Record<string, string>;
    rules?: Array<{
        id: string;
        section: string;
        permittedCommands?: string[];
        prohibitedCommands?: string[];
    }>;
}
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
export interface TaskCompilerConfig {
    insertE2E: boolean;
    maxComplexity: ComplexityEstimate;
    extraProhibitedCommands: string[];
    clock: () => Date;
}
export declare const DEFAULT_TASK_COMPILER_CONFIG: TaskCompilerConfig;
export declare enum TaskCompilerErrorCode {
    CYCLIC_DEPENDENCY = "CYCLIC_DEPENDENCY",
    EMPTY_OBJECTIVE = "EMPTY_OBJECTIVE",
    NO_VERIFICATION = "NO_VERIFICATION",
    FILE_OVERLAP_CONFLICT = "FILE_OVERLAP_CONFLICT",
    UNSATISFIED_CRITERION = "UNSATISFIED_CRITERION",
    MISSING_CAPABILITY = "MISSING_CAPILITY",
    DESTRUCTIVE_COMMAND_APPROVAL = "DESTRUCTIVE_COMMAND_APPROVAL"
}
export declare class TaskCompilerError extends Error {
    readonly code: TaskCompilerErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: TaskCompilerErrorCode, message: string, details?: Record<string, unknown>);
}
//# sourceMappingURL=types.d.ts.map
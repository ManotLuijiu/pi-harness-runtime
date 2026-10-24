/**
 * The post-change quality check of a JavaScript/TypeScript workspace.
 *
 * The check honors the saved preference: "prefer_biome" runs Biome on the
 * changed files, "use_project_tools" runs the project's own lint script.
 * The check never writes: it reports what it found and the agent fixes it.
 */
import type { ToolingContext } from "./detect.js";
import type { ToolingPreference } from "./proposal.js";
/** The tool that checks the changed files. */
export type QualityCheckTool = "biome" | "project" | "none";
export interface QualityCheckPlan {
    /** The tool that would run. */
    tool: QualityCheckTool;
    /** The binary to run - never a shell string. */
    command: string | null;
    /** The arguments of the command. */
    args: string[];
    /** The files the check looks at. */
    files: string[];
    /** Why this plan - a human wording. */
    reason: string;
}
export interface QualityCheckResult {
    /** Did the check run? */
    ran: boolean;
    /** Did the check pass? Meaningless when the check did not run. */
    passed: boolean;
    /** The tool that ran. */
    tool: QualityCheckTool;
    /** How many files the check looked at. */
    fileCount: number;
    /** The exit code of the check. */
    exitCode: number | null;
    /** Did the check hit the timeout? */
    timedOut: boolean;
    /** The output of the check, truncated. */
    output: string;
    /** Why the result is what it is - a human wording. */
    reason: string;
}
/** The scripts of the workspace, if it has a package.json. */
export declare function readWorkspaceScripts(root: string): Record<string, string>;
/**
 * Choose the check that runs after a change.
 *
 * The preference decides the tool: Biome when the user asked for it, the
 * project's own script otherwise. A workspace without a saved decision is
 * never checked - the user has not chosen a tool yet.
 */
export declare function selectQualityCheck(options: {
    context: ToolingContext;
    preference: ToolingPreference | undefined;
    files: string[];
    scripts?: Record<string, string>;
}): QualityCheckPlan;
/**
 * Run the check.
 *
 * The command is started without a shell, with a timeout, and it never
 * writes: a check that wants to fix files is not a check.
 */
export declare function runQualityCheck(plan: QualityCheckPlan, options: {
    cwd: string;
    timeoutMs?: number;
    maxOutputChars?: number;
}): QualityCheckResult;
/**
 * The status line of the check.
 *
 * The line stays plain ASCII: it is read by the pi host and by terminals
 * without a font of their own.
 */
export declare function formatQualityCheckStatus(result: QualityCheckResult): string;
//# sourceMappingURL=quality-check.d.ts.map
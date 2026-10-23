/**
 * Workspace Environment Detector
 *
 * Detects if the workspace is a development environment by checking:
 * 1. the NODE_ENV of the process env (for build processes)
 * 2. the dotenv files of the workspace (".env", ".env.*"): NODE_ENV, then
 *    an environment shaped key whose VALUE names a known mode (e.g.
 *    AMOS_ENV=development), then any other environment shaped key
 * 3. package.json "dev" script presence
 *
 * Stores detected environment in SQLite for agent reference.
 * Uses synchronous directory creation and exception-safe operations.
 */
import { collectDotenvVars, collectProcessEnvVars, describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, detectModeHint, formatEnvForAgentResult, formatWorkspacePath, modeFromValue, orderDotenvFileNames, parseDotenvVars, resolveWorkspaceMode } from "./workspace-env-format.js";
import type { DotenvVar, EnvEvidence, ServerState, WorkspaceEnvResult, WorkspaceMode } from "./workspace-env-format.js";
/**
 * The mode/evidence types and every human readable rendering of the workspace
 * environment live in workspace-env-format.ts. They are re-exported here so
 * the existing import paths keep working.
 */
export { collectDotenvVars, collectProcessEnvVars, describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, detectModeHint, formatEnvForAgentResult, formatWorkspacePath, modeFromValue, orderDotenvFileNames, parseDotenvVars, resolveWorkspaceMode, };
export { canShowModeValue, isEnvShapedKey, isSecretLikeKey, MASKED_MODE_VALUE } from "./workspace-env-format.js";
export { isTemplateDotenvName, listDotenvFiles, readDotenvFiles } from "./workspace-dotenv.js";
export type { DotenvVar, EnvEvidence, ServerState, WorkspaceEnvResult, WorkspaceMode };
/**
 * Detect and store workspace environment
 */
export declare function detectWorkspaceEnv(workspacePath: string): WorkspaceEnvResult;
/**
 * Load cached workspace environment
 */
export declare function loadWorkspaceEnv(workspacePath: string): WorkspaceEnvResult | null;
/**
 * Get or detect workspace environment
 */
export declare function getWorkspaceEnv(workspacePath: string): WorkspaceEnvResult;
/**
 * Revalidate workspace environment before impactful commands
 */
export declare function revalidateWorkspaceEnv(workspacePath: string): WorkspaceEnvResult;
/**
 * Format workspace env as agent-readable message
 */
export declare function formatEnvForAgent(workspacePath: string): string;
/**
 * Format workspace env as compact status line for UI
 */
export declare function formatEnvStatusLine(env: WorkspaceEnvResult): string;

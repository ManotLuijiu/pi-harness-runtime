/**
 * Workspace Environment Detector
 *
 * Detects if the workspace is a development environment by checking:
 * 1. process.env.NODE_ENV (for build processes)
 * 2. .env file existence and NODE_ENV value
 * 3. package.json "dev" script presence
 *
 * Stores detected environment in SQLite for agent reference.
 * Uses synchronous directory creation and exception-safe operations.
 */
import { describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, formatEnvForAgentResult, formatWorkspacePath } from "./workspace-env-format.js";
import type { EnvEvidence, ServerState, WorkspaceEnvResult, WorkspaceMode } from "./workspace-env-format.js";
/**
 * The mode/evidence types and every human readable rendering of the workspace
 * environment live in workspace-env-format.ts. They are re-exported here so
 * the existing import paths keep working.
 */
export { describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, formatEnvForAgentResult, formatWorkspacePath, };
export type { EnvEvidence, ServerState, WorkspaceEnvResult, WorkspaceMode };
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

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
/**
 * Workspace mode with explicit states
 */
export type WorkspaceMode = "development" | "production" | "test" | "unknown";
/**
 * Evidence source for mode detection
 */
export interface EnvEvidence {
    source: "process.env" | ".env file" | "package.json" | "command" | "detection";
    key: string;
    value: string;
    timestamp: number;
}
/**
 * Workspace environment result
 */
export interface WorkspaceEnvResult {
    workspacePath: string;
    mode: WorkspaceMode;
    evidence: EnvEvidence[];
    hasDevScript: boolean;
    hasBuildScript: boolean;
    packageManager: string | null;
    devServerRunning: boolean;
    buildServerRunning: boolean;
    ramTotalGb: number | null;
    ramAvailableGb: number | null;
    ramEffectiveLimitGb: number | null;
    lowRamWarning: boolean;
    buildAllowed: boolean;
    detectedAt: number;
}
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

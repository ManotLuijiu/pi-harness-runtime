/**
 * Workspace Environment Detector
 *
 * Detects if the workspace is a development environment by checking:
 * 1. .env file existence and NODE_ENV value
 * 2. package.json "dev" script presence
 * 3. .env.development or .env.local files
 *
 * Stores detected environment in SQLite for agent reference.
 */
/**
 * Detect if workspace is a dev environment
 */
export interface WorkspaceEnvResult {
    workspacePath: string;
    isDevEnv: boolean;
    hasDevScript: boolean;
    nodeEnv: string | null;
    hasEnvFile: boolean;
    ramGb: number | null;
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
 * Check if agent should prefer dev mode (no build)
 */
export declare function shouldUseDevMode(workspacePath: string): {
    preferDev: boolean;
    reason: string;
    ramGb: number | null;
};
/**
 * Format workspace env as agent-readable message
 */
export declare function formatEnvForAgent(workspacePath: string): string;

/**
 * Workspace environment formatting helpers.
 *
 * Split out of workspace-env.ts so the wording can be unit tested without the
 * node:sqlite dependency (bun 1.3.x has no node:sqlite module).
 *
 * Wording rules:
 * - The mode is only reported when it is EXPLICIT (NODE_ENV). An unknown mode
 *   is always shown with its reason, never as a bare word next to a dev
 *   server state that could be read as proof of the mode.
 * - A dev/build script is a CAPABILITY, not a state. The status line says
 *   "not running (script available)" so it cannot be mistaken for a running
 *   server or for evidence about the workspace mode.
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
 * Human readable mode label.
 *
 * "unknown" always carries the reason: the mode can only be proven by an
 * explicit NODE_ENV (process env or .env file). When a NODE_ENV IS present
 * but names a mode this detector does not know ("staging"), the label says
 * exactly that instead of claiming there is no NODE_ENV at all.
 */
export declare function describeWorkspaceMode(env: WorkspaceEnvResult): string;
/**
 * Describe a dev/build server as a state.
 *
 * "not running (script available)" means the script EXISTS, i.e. a server
 * could be started. It is not evidence that a server is running and not
 * evidence about the workspace mode.
 */
export declare function describeServerState(running: boolean, hasScript: boolean): string;
/**
 * One line status for the footer / status bar.
 */
export declare function formatEnvStatusLine(env: WorkspaceEnvResult): string;
/**
 * Multi line description for the agent context.
 */
export declare function formatEnvForAgentResult(env: WorkspaceEnvResult): string;

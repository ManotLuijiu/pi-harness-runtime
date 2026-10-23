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
    /**
     * The tri-state state of the dev server.
     *
     * "not detected" means a check ran and found nothing; "not checked"
     * means no check was possible (an unsupported platform or a failed
     * check). Neither of them is evidence that a server is not running.
     */
    devServerState?: ServerState;
    /** The tri-state state of the build server. */
    buildServerState?: ServerState;
    ramTotalGb: number | null;
    ramAvailableGb: number | null;
    ramEffectiveLimitGb: number | null;
    lowRamWarning: boolean;
    buildAllowed: boolean;
    detectedAt: number;
}
/**
 * The state of a dev/build server.
 */
/**
 * Is this command line a package-manager launcher?
 *
 * A launcher ("npm run dev", "bun run start") only STARTS a server - the
 * server is its child. Counting the launcher would report a running
 * server for a script that does not start one at all ("sleep 300").
 *
 * The rule is pure, so it lives in the pure module and can be tested
 * without the SQLite cache.
 */
export declare function isLauncherCommand(cmdline: string): boolean;
export type ServerState = "running" | "not-detected" | "not-checked";
/**
 * The name of the operating system the harness runs on.
 *
 * The OS decides which command shows the working directory (pwd on
 * POSIX, cd / echo %cd% on Windows), so the summary names it.
 */
export declare function describeOs(platformName?: string): string;
/**
 * The command that prints the working directory on this OS.
 */
export declare function describeCwdCommand(platformName?: string): string;
/**
 * Remove the pids of our own processes from a pgrep result.
 *
 * The shell that runs pgrep carries the search pattern in its own command
 * line, so pgrep always reports it - a server would be claimed where none
 * runs. The pids of our own processes are therefore dropped.
 */
export declare function filterOwnPids(pids: string[], ownPids: string[]): string[];
/**
 * Shorten the home directory to "~".
 *
 * The check is on a path boundary: "/home/user" is the home of
 * "/home/user/app", but not of "/home/userX".
 */
export declare function formatWorkspacePath(workspacePath: string, home?: string): string;
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
 * "not detected" is what a check that found nothing says - it is NOT the
 * same as "not running": on a platform where no check is possible the
 * state is "not checked". Neither of them says anything about the
 * workspace mode.
 */
export declare function describeServerState(state: ServerState): string;
export declare function describeServerState(running: boolean, hasScript: boolean): string;
/**
 * One line status for the footer / status bar.
 */
export declare function formatEnvStatusLine(env: WorkspaceEnvResult): string;
/**
 * Multi line description for the agent context.
 */
export declare function formatEnvForAgentResult(env: WorkspaceEnvResult): string;

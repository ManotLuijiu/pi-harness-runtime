/**
 * Workspace environment formatting helpers.
 *
 * Split out of workspace-env.ts so the wording can be unit tested without the
 * node:sqlite dependency (bun 1.3.x has no node:sqlite module).
 *
 * Wording rules:
 * - The mode is only reported when it is EXPLICIT: the NODE_ENV of the
 *   process env, or a variable of the dotenv files of the workspace -
 *   NODE_ENV, an environment shaped key whose value names a known mode
 *   (e.g. AMOS_ENV=development) or any other environment shaped key. An
 *   unknown mode is always shown with its reason, never as a bare word next
 *   to a dev server state that could be read as proof of the mode.
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
    /** The dotenv file a value came from (".env", ".env.local", ...). */
    file?: string;
}
/**
 * A variable found in a dotenv file.
 */
export interface DotenvVar {
    key: string;
    value: string;
    /** The file the variable came from ("" for the process env). */
    file?: string;
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
 * The check is on a path boundary: "/home/frappe" is the home of
 * "/home/frappe/app", but not of "/home/frappeX".
 */
export declare function formatWorkspacePath(workspacePath: string, home?: string): string;
/**
 * Map a raw value to a workspace mode.
 *
 * Returns null for a value that names no known mode ("staging", ""): the
 * caller then reports the mode as unknown and names the value.
 */
export declare function modeFromValue(value: string): WorkspaceMode | null;
/**
 * Parse a dotenv file into its variables.
 *
 * Only the name and the value are kept. A dotenv file holds secrets, so the
 * detector must not copy more than it needs.
 */
export declare function parseDotenvVars(content: string): DotenvVar[];
/**
 * The placeholder for a value that must not be shown.
 */
export declare const MASKED_MODE_VALUE = "<set>";
/**
 * True for a key that names the environment.
 *
 * "NODE_ENV", "AMOS_ENV", "RAILS_ENV", "APP_ENVIRONMENT", "APP_MODE",
 * "APP_STAGE" - but not "BRANCH" or "DEBUG": a key must look like it holds
 * the name of an environment before its value may decide the mode.
 */
export declare function isEnvShapedKey(key: string): boolean;
/**
 * True for a key that may hold a secret.
 */
export declare function isSecretLikeKey(key: string): boolean;
/**
 * True when the value of the variable may be shown.
 *
 * The value ends up in the agent context and in the SQLite cache, so it is
 * only shown when it is provably not a secret: the NODE_ENV of the process
 * env, or a value that IS the name of the mode.
 */
export declare function canShowModeValue(key: string, value: string, source: "process.env" | ".env file"): boolean;
/**
 * Find the variable that names the environment.
 *
 * The search order is the priority the user described:
 * 1. NODE_ENV
 * 2. an environment shaped key whose value names a known mode
 *    (development, production, test) - e.g. AMOS_ENV=development
 * 3. any other environment shaped key (e.g. AMOS_ENV, RAILS_ENV) - it may
 *    be empty or name a mode this detector does not know
 *
 * A usable key wins over an unusable one: an earlier "APP_MODE=staging" or
 * an empty "APP_ENV=" of the same file must not shadow the
 * "AMOS_ENV=development" of that file. The value match is switched off for
 * the process env (an unrelated variable that happens to hold the word
 * "development" says nothing about the environment) and it is restricted to
 * environment shaped keys: "BRANCH=production" does not make a production
 * workspace.
 *
 * The value match is OPT-IN: a caller has to ask for it
 * (`allowValueMatch: true`).
 */
export declare function detectModeHint(vars: DotenvVar[], options?: {
    allowValueMatch?: boolean;
}): DotenvVar | null;
/**
 * Order the dotenv file names of a workspace.
 *
 * The base ".env" wins over the variants, the well known variants come in a
 * fixed order and every other ".env.*" file follows alphabetically.
 */
export declare function orderDotenvFileNames(names: string[]): string[];
/**
 * Read the variables of the dotenv files of a workspace.
 *
 * The first file that defines a key wins (see orderDotenvFileNames).
 */
export declare function collectDotenvVars(files: {
    name: string;
    content: string;
}[]): DotenvVar[];
/**
 * The variables of the process env that can name the environment.
 *
 * Only NODE_ENV and the environment shaped keys are collected: an unrelated
 * variable of the process env must not outrank the workspace files.
 */
export declare function collectProcessEnvVars(env?: NodeJS.ProcessEnv): DotenvVar[];
/**
 * The result of the mode detection: the mode plus the variable it came from.
 */
export interface ModeResolution {
    mode: WorkspaceMode;
    hint: DotenvVar | null;
    source: "process.env" | ".env file" | null;
}
/**
 * Resolve the workspace mode from the variables that were found.
 *
 * The order is:
 * 1. the NODE_ENV of the process env - it decides, also when it names no
 *    known mode (then the mode stays unknown and the label names it: an
 *    explicit "staging" must not be overwritten by a file)
 * 2. the dotenv files of the workspace: NODE_ENV, then an environment
 *    shaped key WHOSE VALUE names a known mode (e.g. AMOS_ENV=development),
 *    then any other environment shaped key (so that the label can name it)
 * 3. an environment shaped key of the process env (the files are silent)
 */
export declare function resolveWorkspaceMode(processVars: DotenvVar[], dotenvVars: DotenvVar[]): ModeResolution;
/**
 * Human readable mode label.
 *
 * "unknown" always carries the reason: the mode can only be proven by an
 * explicit variable - NODE_ENV, another *_ENV key (e.g. AMOS_ENV) or a
 * value that names a known mode. When such a variable IS present but names
 * a mode this detector does not know ("staging"), the label says exactly
 * that instead of claiming there is no variable at all.
 *
 * A known mode names its source: "DEVELOPMENT (from AMOS_ENV in .env)".
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

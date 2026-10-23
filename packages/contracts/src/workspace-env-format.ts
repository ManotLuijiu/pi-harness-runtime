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
export function isLauncherCommand(cmdline: string): boolean {
	return /^(npm|bun|yarn|pnpm)\b.*\b(run\s+)?(dev|start)\b/.test(cmdline.trim());
}

export type ServerState = "running" | "not-detected" | "not-checked";

/**
 * The name of the operating system the harness runs on.
 *
 * The OS decides which command shows the working directory (pwd on
 * POSIX, cd / echo %cd% on Windows), so the summary names it.
 */
export function describeOs(platformName?: string): string {
	const name = platformName ?? process.platform;
	switch (name) {
		case "linux":
			return "Linux";
		case "darwin":
			return "macOS";
		case "win32":
			return "Windows";
		default:
			return name;
	}
}

/**
 * The command that prints the working directory on this OS.
 */
export function describeCwdCommand(platformName?: string): string {
	switch (platformName ?? process.platform) {
		case "win32":
			return "cd or echo %cd% (CMD), or (Get-Location).Path (PowerShell)";
		case "linux":
		case "darwin":
			return "pwd";
		default:
			return "pwd (POSIX shells)";
	}
}

/**
 * Remove the pids of our own processes from a pgrep result.
 *
 * The shell that runs pgrep carries the search pattern in its own command
 * line, so pgrep always reports it - a server would be claimed where none
 * runs. The pids of our own processes are therefore dropped.
 */
export function filterOwnPids(pids: string[], ownPids: string[]): string[] {
	const own = new Set(ownPids.map((pid) => pid.trim()));
	return pids.map((pid) => pid.trim()).filter((pid) => pid.length > 0 && !own.has(pid));
}

/**
 * Shorten the home directory to "~".
 *
 * The check is on a path boundary: "/home/frappe" is the home of
 * "/home/frappe/app", but not of "/home/frappeX".
 */
export function formatWorkspacePath(workspacePath: string, home?: string): string {
	if (!workspacePath) return "";
	// A trailing separator is not part of the path.
	const path = workspacePath.replace(/[\\/]+$/, "") || workspacePath;
	const homeDir = (home ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "").replace(
		/[\\/]+$/,
		"",
	);
	// A root home ("/") shortens nothing - every path would look like "~".
	if (homeDir && homeDir !== "/" && path.startsWith(homeDir)) {
		const rest = path.slice(homeDir.length);
		if (rest === "") return "~";
		if (rest.startsWith("/") || rest.startsWith("\\")) return `~${rest}`;
	}
	return path;
}

/**
 * Human readable mode label.
 *
 * "unknown" always carries the reason: the mode can only be proven by an
 * explicit NODE_ENV (process env or .env file). When a NODE_ENV IS present
 * but names a mode this detector does not know ("staging"), the label says
 * exactly that instead of claiming there is no NODE_ENV at all.
 */
export function describeWorkspaceMode(env: WorkspaceEnvResult): string {
	if (env.mode !== "unknown") {
		return env.mode.toUpperCase();
	}
	const nodeEnv = env.evidence.find(
		(e) => e.key === "NODE_ENV" && (e.source === "process.env" || e.source === ".env file"),
	);
	if (nodeEnv) {
		return `UNKNOWN (NODE_ENV=${nodeEnv.value} is not a known mode)`;
	}
	return "UNKNOWN (no explicit NODE_ENV)";
}

/**
 * Describe a dev/build server as a state.
 *
 * "not detected" is what a check that found nothing says - it is NOT the
 * same as "not running": on a platform where no check is possible the
 * state is "not checked". Neither of them says anything about the
 * workspace mode.
 */
export function describeServerState(state: ServerState): string;
export function describeServerState(running: boolean, hasScript: boolean): string;
export function describeServerState(
	stateOrRunning: ServerState | boolean,
	hasScript?: boolean,
): string {
	// The legacy signature (a boolean plus the script flag) is kept so that
	// published consumers keep working.
	if (typeof stateOrRunning === "boolean") {
		if (stateOrRunning) return "running";
		return hasScript ? "not running (script available)" : "no script";
	}
	switch (stateOrRunning) {
		case "running":
			return "running";
		case "not-detected":
			return "not detected";
		case "not-checked":
			return "not checked";
		default:
			// An unknown state is never reported as "not running".
			return "not checked";
	}
}

/**
 * One line status for the footer / status bar.
 */
export function formatEnvStatusLine(env: WorkspaceEnvResult): string {
	const mode = describeWorkspaceMode(env);
	// Without a stored state the honest answer is "not checked" - a legacy
	// row that says "false" cannot tell a missing server from a platform
	// where no check was possible.
	const devState = env.devServerState ?? (env.devServerRunning ? "running" : "not-checked");
	const buildState =
		env.buildServerState ?? (env.buildServerRunning ? "running" : "not-checked");
	const path = formatWorkspacePath(env.workspacePath);

	let status =
		`Workspace: ${path} | OS: ${describeOs()} | mode: ${mode}` +
		` | dev server: ${describeServerState(devState)}` +
		` | dev script: ${env.hasDevScript ? "available" : "unavailable"}` +
		` | build server: ${describeServerState(buildState)}` +
		` | build script: ${env.hasBuildScript ? "available" : "unavailable"}`;
	const ramStr = formatRam(env);
	if (ramStr) {
		status += ` | RAM: ${ramStr}`;
	}

	return status;
}

/**
 * RAM segment of the status line.
 *
 * Both values are optional - an unreadable /proc must never produce a
 * "7.7/null" line.
 */
function formatRam(env: WorkspaceEnvResult): string {
	const total = env.ramTotalGb;
	const available = env.ramAvailableGb;
	if (total === null && available === null) return "";
	if (total === null) return `${available}GB available`;
	if (available === null) return `${total}GB total`;
	return `${available}/${total}`;
}

/**
 * RAM segment for the agent block.
 */
function formatRamForAgent(env: WorkspaceEnvResult): string {
	const total = env.ramTotalGb;
	const available = env.ramAvailableGb;
	if (total !== null && available !== null) return `${available}/${total}GB available`;
	if (total !== null) return `${total}GB total`;
	return `${available}GB available`;
}

/**
 * Multi line description for the agent context.
 */
export function formatEnvForAgentResult(env: WorkspaceEnvResult): string {
	let message = `[Workspace Environment]\n`;
	message += `Mode: ${describeWorkspaceMode(env)}\n`;
	message += `OS: ${describeOs()}\n`;
	message += `Workspace path: ${formatWorkspacePath(env.workspacePath)}\n`;
	message += `The workspace path was captured from the process working directory - to verify it in a shell: ${describeCwdCommand()}\n`;

	if (env.evidence.length > 0) {
		const sources = env.evidence.map((e) => `${e.source}:${e.value}`).join(", ");
		message += `Evidence: ${sources}\n`;
	}

	message += `Dev script: ${env.hasDevScript ? "yes" : "no"}\n`;
	message += `Build script: ${env.hasBuildScript ? "yes" : "no"}\n`;

	const devState = env.devServerState ?? (env.devServerRunning ? "running" : "not-checked");
	const buildState = env.buildServerState ?? (env.buildServerRunning ? "running" : "not-checked");
	message += `Dev server: ${describeServerState(devState)}\n`;
	message += `Build server: ${describeServerState(buildState)}\n`;

	if (env.ramTotalGb !== null || env.ramAvailableGb !== null) {
		message += `RAM: ${formatRamForAgent(env)}\n`;
		if (env.lowRamWarning) {
			message += `WARNING: Low RAM - avoid parallel build + dev\n`;
		}
	}

	message += `\n`;
	message += `Build allowed: ${env.buildAllowed ? "yes" : "no - requires explicit request"}\n`;

	if (env.mode === "unknown") {
		message += `\nNOTE: Environment unknown - a dev/build script only means a server CAN be started, it does not establish the workspace mode. Explicitly ask the user before build.\n`;
	}

	return message;
}

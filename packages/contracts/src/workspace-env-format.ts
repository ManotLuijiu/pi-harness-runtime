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
 * "not running (script available)" means the script EXISTS, i.e. a server
 * could be started. It is not evidence that a server is running and not
 * evidence about the workspace mode.
 */
export function describeServerState(running: boolean, hasScript: boolean): string {
	if (running) return "running";
	if (hasScript) return "not running (script available)";
	return "no script";
}

/**
 * One line status for the footer / status bar.
 */
export function formatEnvStatusLine(env: WorkspaceEnvResult): string {
	const mode = describeWorkspaceMode(env);
	const devStatus = describeServerState(env.devServerRunning, env.hasDevScript);
	const buildStatus = describeServerState(env.buildServerRunning, env.hasBuildScript);

	let status = `Workspace: ${mode} | dev server: ${devStatus} | build: ${buildStatus}`;
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

	if (env.evidence.length > 0) {
		const sources = env.evidence.map((e) => `${e.source}:${e.value}`).join(", ");
		message += `Evidence: ${sources}\n`;
	}

	message += `Dev script: ${env.hasDevScript ? "yes" : "no"}\n`;
	message += `Build script: ${env.hasBuildScript ? "yes" : "no"}\n`;

	if (env.devServerRunning) {
		message += `Dev server: running\n`;
	}
	if (env.buildServerRunning) {
		message += `Build server: running\n`;
	}

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

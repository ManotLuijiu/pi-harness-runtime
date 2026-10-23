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
export function isLauncherCommand(cmdline: string): boolean {
	return /^(npm|bun|yarn|pnpm)\b.*\b(run\s+)?(dev|start)\b/.test(cmdline.trim());
}

/**
 * The RAM rule behind the "low memory" warning.
 *
 * The warning exists to avoid running a build AND a dev server in parallel,
 * so it is about the headroom that is actually available - not about the size
 * of the machine. A 15 GB laptop with 6.5 GB free can build; a 32 GB server
 * with 3 GB free cannot.
 *
 * - Below 4 GB free: always low.
 * - Below 16 GB total: a small machine needs real headroom (6 GB) before a
 *   parallel build and dev server are safe.
 */
export function isLowRamWarning(totalGb: number | null, availableGb: number | null): boolean {
	if (availableGb === null) return false;
	if (availableGb < 4) return true;
	if (totalGb === null) return false;
	return totalGb < 16 && availableGb < 6;
}

/**
 * The headroom a build needs before it is allowed in development mode.
 */
export const MIN_BUILD_HEADROOM_GB = 2;

/**
 * The reason the build permission is (not) given.
 *
 * The agent has to know WHY a build is not allowed: an unknown environment
 * needs an explicit request, a memory shortage needs a lighter build.
 */
export function buildAllowanceReason(env: WorkspaceEnvResult): string {
	if (env.buildAllowed) return "yes";
	if (env.mode === "unknown") return "no - requires explicit request";
	if (env.lowRamWarning) return "no - low memory";
	return "no - requires explicit request";
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
 * The check is on a path boundary: "/home/user" is the home of
 * "/home/user/app", but not of "/home/userX".
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
 * Map a raw value to a workspace mode.
 *
 * Returns null for a value that names no known mode ("staging", ""): the
 * caller then reports the mode as unknown and names the value.
 */
export function modeFromValue(value: string): WorkspaceMode | null {
	const v = value.trim().toLowerCase();
	if (v === "production" || v === "prod") return "production";
	if (v === "development" || v === "dev") return "development";
	if (v === "test" || v === "testing") return "test";
	return null;
}

/**
 * Read the value of one dotenv line.
 *
 * Handles: KEY=value, KEY: value, export KEY=value, quoted values and a
 * trailing comment. A quoted value keeps everything up to the closing quote
 * (a "#" inside the quotes is part of the value). An inline comment of an
 * unquoted value needs the space (" #"), like npm dotenv: a "#" inside a
 * value ("abc#123") stays part of the value.
 */
function parseDotenvValue(raw: string): string {
	const value = raw.trim();
	if (value.startsWith('"') || value.startsWith("'")) {
		const quote = value[0];
		const end = value.indexOf(quote, 1);
		return end === -1 ? value.slice(1) : value.slice(1, end);
	}
	const hash = value.indexOf(" #");
	if (hash !== -1) return value.slice(0, hash).trim();
	return value;
}

/**
 * Parse a dotenv file into its variables.
 *
 * Only the name and the value are kept. A dotenv file holds secrets, so the
 * detector must not copy more than it needs.
 */
export function parseDotenvVars(content: string): DotenvVar[] {
	const vars: DotenvVar[] = [];
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*)$/);
		if (!match) continue;
		vars.push({ key: match[1], value: parseDotenvValue(match[2]) });
	}
	return vars;
}

/**
 * The placeholder for a value that must not be shown.
 */
export const MASKED_MODE_VALUE = "<set>";

/**
 * True for a key that names the environment.
 *
 * "NODE_ENV", "AMOS_ENV", "RAILS_ENV", "APP_ENVIRONMENT", "APP_MODE",
 * "APP_STAGE" - but not "BRANCH" or "DEBUG": a key must look like it holds
 * the name of an environment before its value may decide the mode.
 */
export function isEnvShapedKey(key: string): boolean {
	return /(^|_)(ENV|ENVIRONMENT|MODE|STAGE)$/i.test(key);
}

/**
 * The namespaces of the desktop session variables.
 *
 * A session variable names the desktop session ("GNOME_SHELL_SESSION_MODE",
 * "XDG_SESSION_TYPE"), never the environment of a workspace. Some of them
 * end in "_MODE" or "_ENV", so without this list they look like an
 * environment selector and decide the mode of a workspace that has no
 * environment at all.
 */
const SESSION_VARIABLE_PREFIXES = [
	"GNOME_",
	"XDG_",
	"DESKTOP_",
	"DBUS_",
	"GDM_",
	"SDDM_",
	"LIGHTDM_",
	"GTK_",
	"QT_",
	"MATE_",
	"KDE_",
	"PLASMA_",
	"UNITY_",
	"XFCE_",
	"CINNAMON_",
	"WAYLAND_",
	"MIR_",
	"I3_",
	"TERM_",
	"SSH_",
	"TMUX_",
];

/**
 * True for a key that belongs to the desktop session, not to the workspace.
 *
 * The rule is a namespace list, not a value check: the value of a session
 * variable ("ubuntu", "wayland", "user") says nothing about the environment
 * of a workspace, so such a variable must never name the mode.
 */
export function isSessionVariableKey(key: string): boolean {
	const upper = key.toUpperCase();
	return SESSION_VARIABLE_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * True for a key that may hold a secret.
 */
export function isSecretLikeKey(key: string): boolean {
	return /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|KEY|CREDENTIAL|AUTH)/i.test(key);
}

/**
 * True when the value of the variable may be shown.
 *
 * The value ends up in the agent context and in the SQLite cache, so it is
 * only shown when it is provably not a secret: the NODE_ENV of the process
 * env, or a value that IS the name of the mode.
 */
export function canShowModeValue(
	key: string,
	value: string,
	source: "process.env" | ".env file",
): boolean {
	if (isSecretLikeKey(key)) return false;
	if (source === "process.env" && key === "NODE_ENV") return true;
	return modeFromValue(value) !== null;
}

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
export function detectModeHint(
	vars: DotenvVar[],
	options: { allowValueMatch?: boolean } = {},
): DotenvVar | null {
	const nodeEnv = vars.find((v) => v.key === "NODE_ENV");
	if (nodeEnv) return nodeEnv;
	// A session variable is not an environment selector: it must never
	// become the hint that names the mode.
	const usableVars = vars.filter((v) => !isSessionVariableKey(v.key));
	// The value match is opt-in: a caller that passes the process env
	// variables must not let an unrelated variable that happens to hold the
	// word "development" decide the mode.
	if (options.allowValueMatch === true) {
		// An environment shaped key whose value names a known mode wins: an
		// earlier "APP_MODE=staging" or an empty "APP_ENV=" of the same file
		// must not shadow the "AMOS_ENV=development" of the same file.
		const usable = usableVars.find(
			(v) =>
				v.key !== "NODE_ENV" &&
				isEnvShapedKey(v.key) &&
				modeFromValue(v.value) !== null,
		);
		if (usable) return usable;
	}
	// No usable key: fall back to the first environment shaped key so that
	// the label can name it (it names no known mode).
	return (
		usableVars.find((v) => v.key !== "NODE_ENV" && isEnvShapedKey(v.key)) ?? null
	);
}

/**
 * The dotenv files of a workspace, in the order they are read.
 *
 * ".env" comes first, then the well known variants, then every other
 * ".env.*" file. The first file that defines A KEY wins: the base ".env" is
 * the checked in default, so a key that is only defined in a variant is
 * read from the variant (the precedence is per key, not per mode).
 */
const DOTENV_FILE_ORDER = [
	".env",
	".env.local",
	".env.development",
	".env.dev",
	".env.production",
	".env.test",
];

/**
 * Order the dotenv file names of a workspace.
 *
 * The base ".env" wins over the variants, the well known variants come in a
 * fixed order and every other ".env.*" file follows alphabetically.
 */
export function orderDotenvFileNames(names: string[]): string[] {
	const known = DOTENV_FILE_ORDER.filter((name) => names.includes(name));
	const rest = names
		.filter((name) => name.startsWith(".env.") && !DOTENV_FILE_ORDER.includes(name))
		.sort();
	return [...known, ...rest];
}

/**
 * Read the variables of the dotenv files of a workspace.
 *
 * The first file that defines a key wins (see orderDotenvFileNames).
 */
export function collectDotenvVars(files: { name: string; content: string }[]): DotenvVar[] {
	const vars: DotenvVar[] = [];
	const seen = new Set<string>();
	for (const file of orderDotenvFileNames(files.map((f) => f.name))) {
		const content = files.find((f) => f.name === file)?.content ?? "";
		for (const variable of parseDotenvVars(content)) {
			if (seen.has(variable.key)) continue;
			seen.add(variable.key);
			vars.push({ key: variable.key, value: variable.value, file });
		}
	}
	return vars;
}

/**
 * The variables of the process env that can name the environment.
 *
 * Only NODE_ENV and the environment shaped keys are collected: an unrelated
 * variable of the process env must not outrank the workspace files.
 */
export function collectProcessEnvVars(env: NodeJS.ProcessEnv = process.env): DotenvVar[] {
	const vars: DotenvVar[] = [];
	for (const key of Object.keys(env)) {
		const value = env[key];
		if (value === undefined) continue;
		// A session variable of the desktop is never an environment
		// selector, so it is not even collected as a candidate.
		if (isSessionVariableKey(key)) continue;
		if (key === "NODE_ENV" || isEnvShapedKey(key)) {
			vars.push({ key, value });
		}
	}
	return vars;
}

/**
 * The result of the mode detection: the mode plus the variable it came from.
 */
export interface ModeResolution {
	mode: WorkspaceMode;
	hint: DotenvVar | null;
	source: "process.env" | ".env file" | null;
}

/**
 * The deployment configuration of a repository.
 *
 * A repository that carries one of these files is deployed somewhere: it
 * has a runtime environment of its own, so the shape of the repository
 * cannot prove that the workspace is a development checkout.
 */
export const DEPLOYMENT_MARKER_FILES = [
	"Dockerfile",
	"Containerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
	"compose.yml",
	"compose.yaml",
	"Procfile",
	"fly.toml",
	"render.yaml",
	"railway.json",
	"vercel.json",
	"netlify.toml",
	"serverless.yml",
	"serverless.yaml",
	"app.yaml",
	"ecosystem.config.cjs",
	"ecosystem.config.js",
] as const;

/**
 * The facts about the repository the workspace belongs to.
 *
 * They are read from the file system (and from git), never from a variable:
 * a published package that is deployed nowhere is source code that the
 * user runs on their own machine.
 */
export interface RepositoryFacts {
	/** The workspace is a git checkout. */
	isGitRepository: boolean;
	/** The current branch ("" when it cannot be read). */
	branch: string;
	/** The package.json describes a package that is published to a registry. */
	isPublishedPackage: boolean;
	/** The repository carries a deployment configuration. */
	hasDeploymentMarker: boolean;
	/** A dev or build server runs in this workspace. */
	hasRunningServer: boolean;
}

/**
 * A mode that the facts about the repository named.
 */
export interface RepositoryModeDetection {
	mode: WorkspaceMode;
	/**
	 * The phrase that names the detection.
	 *
	 * It is used as the key of the evidence ("source-only repository",
	 * "git branch develop"), so the label can name it the same way it
	 * names a variable.
	 */
	key: string;
}

/**
 * The branches that name a development line of work.
 */
const DEVELOPMENT_BRANCHES = new Set(["develop", "development"]);

/**
 * Name the mode of a workspace from the facts about its repository.
 *
 * This is the LAST tier of the mode detection: it runs only when no
 * variable names the environment at all. It never claims production - a
 * checkout of a production branch is not a production environment, and the
 * deployment marker of the repository keeps the answer honest.
 *
 * Two sets of facts name a development workspace:
 * 1. a published package without a deployment configuration and without a
 *    running server: source code that the user runs on their own machine
 * 2. a branch that names a development line of work ("develop")
 */
export function modeFromRepositoryFacts(facts: RepositoryFacts): RepositoryModeDetection | null {
	if (!facts.isGitRepository) return null;
	if (facts.isPublishedPackage && !facts.hasDeploymentMarker && !facts.hasRunningServer) {
		return { mode: "development", key: "source-only repository" };
	}
	const branch = facts.branch.trim().toLowerCase();
	if (DEVELOPMENT_BRANCHES.has(branch)) {
		return { mode: "development", key: `git branch ${branch}` };
	}
	return null;
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
export function resolveWorkspaceMode(
	processVars: DotenvVar[],
	dotenvVars: DotenvVar[]
): ModeResolution {
	const processNodeEnv = processVars.find((v) => v.key === "NODE_ENV");
	if (processNodeEnv) {
		const mode = modeFromValue(processNodeEnv.value);
		if (mode) return { mode, hint: processNodeEnv, source: "process.env" };
		// An explicit NODE_ENV that names no known mode decides: the mode
		// stays unknown instead of falling through to the files.
		return { mode: "unknown", hint: processNodeEnv, source: "process.env" };
	}
	const dotenvHint = detectModeHint(dotenvVars, { allowValueMatch: true });
	if (dotenvHint) {
		const mode = modeFromValue(dotenvHint.value);
		if (mode) return { mode, hint: dotenvHint, source: ".env file" };
		// The workspace file is explicit - even when its value names no known
		// mode ("APP_MODE=staging"). It must not be replaced by an unrelated
		// variable of the process env.
		return { mode: "unknown", hint: dotenvHint, source: ".env file" };
	}
	// Last resort: an environment shaped key of the process env (the files
	// are silent).
	const processEnvHint = processVars.find(
		(v) => v.key !== "NODE_ENV" && isEnvShapedKey(v.key),
	);
	if (processEnvHint) {
		const mode = modeFromValue(processEnvHint.value);
		if (mode) return { mode, hint: processEnvHint, source: "process.env" };
		return { mode: "unknown", hint: processEnvHint, source: "process.env" };
	}
	return { mode: "unknown", hint: null, source: null };
}

/**
 * The evidence entry that names the environment (if any).
 */
function findModeEvidence(env: WorkspaceEnvResult): EnvEvidence | undefined {
	const candidates = env.evidence.filter(
		(e) => e.source === "process.env" || e.source === ".env file",
	);
	// A value that names a known mode wins over a value that cannot be read.
	return candidates.find((e) => modeFromValue(e.value) !== null) ?? candidates[0];
}

/**
 * The evidence entry that names the mode through the repository (if any).
 *
 * A detection is weaker than a variable: it is the shape of the checkout,
 * not a declaration of the environment. It is therefore only used when no
 * variable names the environment at all.
 */
function findDetectionEvidence(env: WorkspaceEnvResult): EnvEvidence | undefined {
	return env.evidence.find((e) => e.source === "detection");
}

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
export function describeWorkspaceMode(env: WorkspaceEnvResult): string {
	const hint = findModeEvidence(env);
	const where = hint?.file ? ` in ${hint.file}` : "";
	if (env.mode !== "unknown") {
		if (hint) return `${env.mode.toUpperCase()} (from ${hint.key}${where})`;
		// The mode came from the repository, not from a variable: the label
		// names the reason ("DEVELOPMENT (source-only repository)").
		const detection = findDetectionEvidence(env);
		if (detection) return `${env.mode.toUpperCase()} (${detection.key})`;
		return env.mode.toUpperCase();
	}
	if (hint) {
		// The stored mode and the evidence can disagree (a stale cache row):
		// when the value names a mode, that mode is shown - the label must
		// never claim that a known mode is unknown.
		const named = modeFromValue(hint.value);
		if (named) return `${named.toUpperCase()} (from ${hint.key}${where})`;
		if (!hint.value) return `UNKNOWN (${hint.key} is empty${where})`;
		// A value that was masked (a secret or a dotenv value that names no
		// known mode) is not shown - only the key and the file are.
		if (hint.value === MASKED_MODE_VALUE) {
			const subject = where ? `${hint.key}${where}` : `${hint.key} is set and`;
			return `UNKNOWN (${subject} names no known mode)`;
		}
		return `UNKNOWN (${hint.key}=${hint.value} is not a known mode${where})`;
	}
	// A stale cache row can carry a detection next to an unknown mode: the
	// detection names a mode, so the mode is shown.
	const detection = findDetectionEvidence(env);
	if (detection) {
		const named = modeFromValue(detection.value);
		if (named) return `${named.toUpperCase()} (${detection.key})`;
	}
	return "UNKNOWN (no NODE_ENV or environment variable found)";
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
	message += `Build allowed: ${buildAllowanceReason(env)}\n`;

	if (env.mode === "unknown") {
		message += `\nNOTE: Environment unknown - a dev/build script only means a server CAN be started, it does not establish the workspace mode. Explicitly ask the user before build.\n`;
	}

	return message;
}

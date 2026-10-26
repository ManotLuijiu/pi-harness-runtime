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

import { homedir as osHomedir } from "node:os";
import { createRequire } from "node:module";
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, readlinkSync, realpathSync } from "fs";
import { join } from "path";
import { platform, totalmem, freemem } from "os";
import {
	canShowModeValue,
	collectDotenvVars,
	collectProcessEnvVars,
	describeCwdCommand,
	describeOs,
	describeServerState,
	describeWorkspaceMode,
	detectModeHint,
	DEPLOYMENT_MARKER_FILES,
	filterOwnPids,
	formatEnvForAgentResult,
	formatEnvStatusLine as formatStatusLine,
	formatWorkspacePath,
	isLauncherCommand,
	isLowRamWarning,
	MASKED_MODE_VALUE,
	MIN_BUILD_HEADROOM_GB,
	modeFromRepositoryFacts,
	modeFromValue,
	orderDotenvFileNames,
	parseDotenvVars,
	resolveWorkspaceMode,
} from "./workspace-env-format.js";
import { readDotenvFiles } from "./workspace-dotenv.js";
import type {
	DotenvVar,
	EnvEvidence,
	RepositoryFacts,
	ServerState,
	WorkspaceEnvResult,
	WorkspaceMode,
} from "./workspace-env-format.js";

const STORE_DIR = join(process.env.HOME || osHomedir(), ".pi-harness-runtime");

/**
 * Ensure store directory exists synchronously
 */
function ensureStoreDir(): void {
	if (!existsSync(STORE_DIR)) {
		mkdirSync(STORE_DIR, { recursive: true });
	}
}

/**
 * Get workspace database path
 */
function getDbPath(): string {
	ensureStoreDir();
	return join(STORE_DIR, "workspace-env.sqlite");
}

/**
 * Load the SQLite binding lazily.
 *
 * `node:sqlite` does not exist in every runtime (Bun 1.3 has no
 * `node:sqlite`), and a static import makes the whole module unloadable
 * there. The store is a cache: without the database the detector still
 * works, it just does not remember what it found.
 */
function loadDatabaseSync(): typeof import("node:sqlite").DatabaseSync | null {
	try {
		const require = createRequire(import.meta.url);
		return require("node:sqlite").DatabaseSync;
	} catch {
		return null;
	}
}

/**
 * Initialize workspace environment database
 */
function initDatabase(): import("node:sqlite").DatabaseSync | null {
	const DatabaseSync = loadDatabaseSync();
	if (!DatabaseSync) return null;
	ensureStoreDir();
	const db = new DatabaseSync(getDbPath());
	db.exec(`
		CREATE TABLE IF NOT EXISTS workspace_env (
			workspace_path TEXT PRIMARY KEY,
			mode TEXT NOT NULL DEFAULT 'unknown',
			evidence TEXT NOT NULL DEFAULT '[]',
			has_dev_script INTEGER NOT NULL DEFAULT 0,
			has_build_script INTEGER NOT NULL DEFAULT 0,
			package_manager TEXT,
			dev_server_running INTEGER NOT NULL DEFAULT 0,
			build_server_running INTEGER NOT NULL DEFAULT 0,
			dev_server_state TEXT,
			build_server_state TEXT,
			ram_total_gb REAL,
			ram_available_gb REAL,
			ram_effective_limit_gb REAL,
			low_ram_warning INTEGER NOT NULL DEFAULT 0,
			build_allowed INTEGER NOT NULL DEFAULT -1,
			detected_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);
	// Older caches have no state columns. The columns are added without
	// touching the existing rows, so a cache written by an older version
	// stays readable. The column names are literals, never input.
	try {
		db.exec("ALTER TABLE workspace_env ADD COLUMN dev_server_state TEXT");
	} catch {
		// The column exists already.
	}
	try {
		db.exec("ALTER TABLE workspace_env ADD COLUMN build_server_state TEXT");
	} catch {
		// The column exists already.
	}
	return db;
}

/**
 * The mode/evidence types and every human readable rendering of the workspace
 * environment live in workspace-env-format.ts. They are re-exported here so
 * the existing import paths keep working.
 */
export {
	collectDotenvVars,
	collectProcessEnvVars,
	describeCwdCommand,
	describeOs,
	describeServerState,
	describeWorkspaceMode,
	detectModeHint,
	formatEnvForAgentResult,
	formatWorkspacePath,
	modeFromValue,
	orderDotenvFileNames,
	parseDotenvVars,
	resolveWorkspaceMode,
};
export { canShowModeValue, isEnvShapedKey, isSecretLikeKey, MASKED_MODE_VALUE } from "./workspace-env-format.js";
export { isTemplateDotenvName, listDotenvFiles, readDotenvFiles } from "./workspace-dotenv.js";
export type { DotenvVar, EnvEvidence, ServerState, WorkspaceEnvResult, WorkspaceMode };

/**
 * Detect RAM information
 */
function detectRamInfo(): {
	total: number | null;
	available: number | null;
	lowWarning: boolean;
} {
	try {
		const totalBytes = totalmem();
		const freeBytes = freemem();
		const totalGb = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
		const availableGb = Math.round((freeBytes / (1024 ** 3)) * 10) / 10;

		return {
			total: totalGb,
			available: availableGb,
			lowWarning: isLowRamWarning(totalGb, availableGb),
		};
	} catch {
		return { total: null, available: null, lowWarning: false };
	}
}

/**
 * Check if dev/build server is running
 */
/**
 * The executable of a process.
 *
 * A shell that once ran "npm run dev" carries the command in its own
 * command line, so pgrep matches it. A shell is not a server, so the
 * shells are dropped from the result.
 */
function processExe(pid: string): string {
	if (!/^\d+$/.test(pid)) return "";
	try {
		if (platform() === "linux") {
			const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
			const first = raw.split("\0")[0] ?? "";
			return first.split("/").pop() ?? "";
		}
		if (platform() === "darwin") {
			const out = execSync(`ps -o comm= -p ${pid} 2>/dev/null || true`, {
				encoding: "utf8",
				timeout: 2000,
			});
			return out.trim().split("/").pop() ?? "";
		}
	} catch {
		// The process is gone or unreadable.
	}
	return "";
}

/**
 * Is the executable a shell?
 *
 * A shell that runs a command with "-c" is a LAUNCHER ("bash -c 'npm run
 * dev'"), not a server - such a process carries the pattern in its own
 * command line and would be a false positive. A shell that runs a SCRIPT
 * ("./dev.sh", a shebang) is a real server and is kept.
 */
function isShellExe(exe: string): boolean {
	return /^(sh|bash|dash|zsh|ksh|csh|fish|busybox)$/.test(exe);
}

/**
 * The parent pid of a process.
 */
function parentPid(pid: string): string {
	try {
		if (platform() === "linux") {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			// The command name can contain spaces and parentheses, so the
			// fields are read after the LAST ")".
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			// fields[0] = state, fields[1] = ppid
			const ppid = Number.parseInt(fields[1] ?? "", 10);
			return Number.isFinite(ppid) && ppid > 1 ? String(ppid) : "";
		}
		if (platform() === "darwin") {
			const out = execSync(`ps -o ppid= -p ${pid} 2>/dev/null || true`, {
				encoding: "utf8",
				timeout: 1000,
			});
			const ppid = Number.parseInt(out.trim(), 10);
			return Number.isFinite(ppid) && ppid > 1 ? String(ppid) : "";
		}
	} catch {
		// The process is gone or unreadable.
	}
	return "";
}

/**
 * The chain of ancestors of a process (the closest parent first).
 *
 * The harness itself is often started THROUGH "bun run dev" - that
 * launcher is an ancestor of this process and would match the dev pattern
 * even though it is not a server. The whole chain is therefore excluded.
 */
function ancestorPids(pid: string): string[] {
	const chain: string[] = [];
	let current = pid;
	for (let depth = 0; depth < 32; depth++) {
		const parent = parentPid(current);
		if (!parent || chain.includes(parent)) break;
		chain.push(parent);
		current = parent;
	}
	return chain;
}

/**
 * Does a process run inside this workspace?
 *
 * The answer is used to scope the server detection: a dev server of ANOTHER
 * project on the same machine is not our server.
 *
 * "yes"  - the process working directory is inside the workspace
 * "no"   - the process works somewhere else
 * "unknown" - the working directory could not be read
 */
function processScope(
	pid: string,
	workspacePath: string,
): "yes" | "no" | "unknown" {
	if (!/^\d+$/.test(pid)) return "unknown";
	try {
		const os = platform();
		let processCwd: string | null = null;
		if (os === "linux") {
			// Linux exposes the working directory of every process.
			processCwd = readlinkSync(`/proc/${pid}/cwd`);
		} else if (os === "darwin") {
			const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null || true`, {
				encoding: "utf8",
				timeout: 1000,
			});
			const match = out
				.split("\n")
				.find((line: string) => line.startsWith("n"));
			processCwd = match ? match.slice(1) : null;
		} else {
			return "unknown";
		}
		if (!processCwd) return "unknown";
		const workspace = realpathSync(workspacePath);
		const cwd = realpathSync(processCwd);
		return cwd === workspace || cwd.startsWith(`${workspace}/`)
			? "yes"
			: "no";
	} catch (error) {
		// The process is GONE (it exited between pgrep and this check) or
		// the workspace does not exist - in both cases the process cannot
		// be a server of this workspace. Only an unreadable process (for
		// example a permission error) leaves the answer unknown.
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") return "no";
		return "unknown";
	}
}

/**
 * The command line of a process.
 */
function processCmdline(pid: string): string {
	try {
		if (platform() === "linux") {
			const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
			return raw.split("\0").filter(Boolean).join(" ");
		}
		if (platform() === "darwin") {
			const out = execSync(`ps -o command= -p ${pid} 2>/dev/null || true`, {
				encoding: "utf8",
				timeout: 1000,
			});
			return out.trim();
		}
	} catch {
		// The process is gone or unreadable.
	}
	return "";
}

/**
 * The patterns that identify a dev server and a build server.
 */
const DEV_SERVER_PATTERN =
	/(next dev|nuxt|(^|[^a-z])vite([^a-z]|$)|webpack|remix dev|npm run dev|bun run dev|yarn dev|pnpm dev|npm run start|bun run start|yarn start|pnpm start)/;
const BUILD_SERVER_PATTERN =
	/(next build|nuxt build|webpack build|npm run build|bun run build|yarn build|pnpm build)/;

/**
 * Is a process tool available at all?
 *
 * Without one no check ran, so the state is "not checked" - never
 * "not detected" (which would claim that a check happened).
 */
function hasProcessTool(): boolean {
	try {
		execSync("command -v pgrep >/dev/null 2>&1", {
			stdio: "ignore",
			timeout: 1000,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * The direct children of a process.
 */
function childPids(pid: string): string[] {
	if (!/^\d+$/.test(pid)) return [];
	try {
		const out = execSync(`pgrep -P ${pid} 2>/dev/null || true`, {
			encoding: "utf8",
			timeout: 500,
		});
		return out
			.split("\n")
			.map((line: string) => line.trim())
			.filter((line: string) => /^\d+$/.test(line));
	} catch {
		return [];
	}
}

/**
 * Does one of the processes listen on a TCP socket?
 *
 * A listening socket is the proof that a process is a SERVER - the command
 * line alone can be anything.
 */
function hasListeningSocket(pids: string[]): boolean {
	const safe = pids.filter((pid) => /^\d+$/.test(pid));
	if (safe.length === 0) return false;
	try {
		const out = execSync(
			`lsof -nP -iTCP -sTCP:LISTEN -a -p ${safe.join(",")} 2>/dev/null || true`,
			{ encoding: "utf8", timeout: 1000 },
		);
		// The first line is the header - a socket is a line after it.
		return out.trim().split("\n").filter((line: string) => line.trim()).length > 1;
	} catch {
		return false;
	}
}

/**
 * Does a process (or one of its descendants) listen on a TCP socket?
 *
 * The levels are checked from the closest to the farthest, so a server
 * that is a direct child is found before a deep tree is walked.
 */
function familyHasListeningSocket(pid: string): boolean {
	let level = [pid];
	const seen = new Set<string>();
	for (let depth = 0; depth < 8 && level.length > 0; depth++) {
		if (hasListeningSocket(level)) return true;
		const next: string[] = [];
		for (const current of level) {
			for (const child of childPids(current)) {
				if (seen.has(child)) continue;
				seen.add(child);
				next.push(child);
			}
		}
		level = next.slice(0, 64);
	}
	return false;
}

/**
 * Is the lsof tool available?
 */
function hasLsof(): boolean {
	try {
		execSync("command -v lsof >/dev/null 2>&1", { stdio: "ignore", timeout: 1000 });
		return true;
	} catch {
		return false;
	}
}

/**
 * Merge two answers about a server state.
 *
 * "running" wins (a server was found), then "not checked" (something
 * could not be read), then "not detected".
 */
function mergeServerState(a: ServerState, b: ServerState): ServerState {
	if (a === "running" || b === "running") return "running";
	if (a === "not-checked" || b === "not-checked") return "not-checked";
	return "not-detected";
}

/**
 * Detect the state of the dev and the build server.
 *
 * The three states are different facts:
 * - "running":      a process matched the pattern AND belongs to this
 *                   workspace
 * - "not-detected": the check ran and found no server of this workspace
 * - "not-checked":  no check was possible (an unsupported platform, no
 *                   process tool, a failed check, or a process whose working
 *                   directory could not be read)
 *
 * "not-checked" must never be reported as "not running": the difference
 * decides whether the user has to look for the server themselves.
 */
function detectServerStates(workspacePath: string): {
	dev: ServerState;
	build: ServerState;
} {
	const os = platform();
	if (os !== "linux" && os !== "darwin") {
		// Windows has no pgrep - no check is possible, so no claim is made.
		return { dev: "not-checked", build: "not-checked" };
	}
	if (!hasProcessTool()) {
		return { dev: "not-checked", build: "not-checked" };
	}
	const lsofAvailable = hasLsof();
	try {
		// ONE pgrep call for both patterns: every call blocks the event
		// loop, and the startup must not wait seconds for a status line.
		const script = `echo $$; pgrep -f ${JSON.stringify(
			`(${DEV_SERVER_PATTERN.source})|(${BUILD_SERVER_PATTERN.source})`,
		)} 2>/dev/null || true`;
		const out = execSync(script, {
			encoding: "utf8",
			timeout: 1000,
		});
		const lines = out.split("\n");
		// The shell that runs pgrep carries the pattern in its OWN command
		// line, so pgrep would always report it. That shell, this process
		// and the whole ancestor chain are excluded - a harness that was
		// started through "bun run dev" has that launcher as an ancestor,
		// and the launcher is not a server.
		const ownPids = [
			String(process.pid),
			String(process.ppid),
			(lines[0] ?? "").trim(),
			...ancestorPids(String(process.pid)),
		];
		const pids = filterOwnPids(lines.slice(1), ownPids);
		let dev: ServerState = "not-detected";
		let build: ServerState = "not-detected";
		for (const pid of pids) {
			const cmdline = processCmdline(pid);
			if (!cmdline) continue;
			// A launcher shell ("bash -c 'npm run dev'") carries the
			// pattern in its own command line and is not a server. A shell
			// that runs a SCRIPT ("./dev.sh") is a server and is kept.
			if (isShellExe(processExe(pid)) && /(^|\s)-c(\s|$)/.test(cmdline)) {
				continue;
			}
			const isDev = DEV_SERVER_PATTERN.test(cmdline);
			const isBuild = BUILD_SERVER_PATTERN.test(cmdline);
			if (!isDev && !isBuild) continue;
			const scope = processScope(pid, workspacePath);
			if (scope === "no") continue;
			if (scope === "unknown") {
				// Only the state of the pattern this process matched is
				// uncertain.
				if (isDev) dev = mergeServerState(dev, "not-checked");
				if (isBuild) build = mergeServerState(build, "not-checked");
				continue;
			}
			if (isLauncherCommand(cmdline)) {
				// A launcher is not the server - the server is its child.
				if (!lsofAvailable) {
					// Without lsof it cannot be shown that a server really
					// listens, so no running state is claimed.
					if (isDev) dev = mergeServerState(dev, "not-checked");
					if (isBuild) build = mergeServerState(build, "not-checked");
					continue;
				}
				if (!familyHasListeningSocket(pid)) continue;
			}
			if (isDev) dev = "running";
			if (isBuild) build = "running";
		}
		return { dev, build };
	} catch {
		// The process check failed - the state is unknown, not "not running".
		return { dev: "not-checked", build: "not-checked" };
	}
}

/**
 * Encode a server state for the cache.
 *
 * The legacy boolean column keeps its meaning (1 = running) so that an
 * OLDER installed version still reads the cache correctly. The precise
 * state lives in its own column.
 */
function encodeServerState(state: ServerState): number {
	return state === "running" ? 1 : 0;
}

/**
 * Decode a server state from the cache.
 *
 * The state column wins. A legacy row (no state column) only knows "a
 * server was running" or "not running" - and the old "not running" cannot
 * tell a missing server from a platform where no check was possible, so
 * it is read back as "not checked" (the honest answer).
 */
function decodeServerState(value: number, state?: string | null): ServerState {
	if (state === "running" || state === "not-detected" || state === "not-checked") {
		return state;
	}
	// Legacy rows: 1 = running, 0 = the old ambiguous "not running".
	if (value === 1) return "running";
	return "not-checked";
}

/**
 * Detect package manager from lock file
 */
function detectPackageManager(workspacePath: string): string | null {
	if (existsSync(join(workspacePath, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(workspacePath, "yarn.lock"))) return "yarn";
	if (existsSync(join(workspacePath, "package-lock.json"))) return "npm";
	return null;
}

/**
 * The git repository of a workspace.
 *
 * The root of the repository is the unit of the detection: a package
 * published from a monorepo is described by the root, not by the folder
 * the harness happens to run in.
 */
function detectGitFacts(workspacePath: string): { root: string; branch: string } {
	try {
		const out = execSync(
			"git rev-parse --show-toplevel 2>/dev/null; git rev-parse --abbrev-ref HEAD 2>/dev/null",
			{ cwd: workspacePath, encoding: "utf8", timeout: 1500 },
		);
		const lines = out.split("\n").map((line) => line.trim());
		const root = lines[0] ?? "";
		const branch = lines[1] ?? "";
		// A detached HEAD reports "HEAD" - that is not a branch name.
		return { root, branch: branch === "HEAD" ? "" : branch };
	} catch {
		// No git, no repository, or a timeout: nothing is known.
		return { root: "", branch: "" };
	}
}

/**
 * True when the package is published to a registry.
 *
 * A package that is published names a version and declares what it ships
 * ("files", "bin" or a "publishConfig"). A repository that only holds an
 * application usually declares none of them - so this stays a careful
 * signal instead of "every package.json is published".
 */
function isPublishedPackage(packageDir: string): boolean {
	const pkgJsonPath = join(packageDir, "package.json");
	if (!existsSync(pkgJsonPath)) return false;
	try {
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
		if (!pkg || typeof pkg !== "object") return false;
		if (pkg.private === true) return false;
		if (typeof pkg.name !== "string" || !pkg.name) return false;
		if (typeof pkg.version !== "string" || !pkg.version) return false;
		return (
			Array.isArray(pkg.files) ||
			(typeof pkg.bin === "object" && pkg.bin !== null) ||
			(typeof pkg.publishConfig === "object" && pkg.publishConfig !== null)
		);
	} catch {
		return false;
	}
}

/**
 * True when the repository carries a deployment configuration.
 *
 * A deployment file or a deploy workflow means the repository has a
 * runtime environment of its own - the shape of the repository can then no
 * longer say that the workspace is a development checkout.
 */
function hasDeploymentConfiguration(repoRoot: string): boolean {
	for (const marker of DEPLOYMENT_MARKER_FILES) {
		if (existsSync(join(repoRoot, marker))) return true;
	}
	const workflowDir = join(repoRoot, ".github", "workflows");
	if (existsSync(workflowDir)) {
		try {
			for (const name of readdirSync(workflowDir)) {
				if (/deploy/i.test(name)) return true;
			}
		} catch {
			// An unreadable directory proves nothing.
		}
	}
	return false;
}

/**
 * Read the facts about the repository the workspace belongs to.
 */
function detectRepositoryFacts(
	workspacePath: string,
	hasRunningServer: boolean,
): RepositoryFacts {
	const { root, branch } = detectGitFacts(workspacePath);
	const repoRoot = root || workspacePath;
	return {
		isGitRepository: root !== "",
		branch,
		isPublishedPackage: isPublishedPackage(repoRoot),
		hasDeploymentMarker: hasDeploymentConfiguration(repoRoot),
		hasRunningServer,
	};
}

/**
 * Determine workspace mode with proper precedence
 * Never assume production - unknown requires investigation
 *
 * The search order (the priority the user described):
 * 1. the NODE_ENV of the process env - it decides, also when it names no
 *    known mode
 * 2. the dotenv files of the workspace: NODE_ENV, then an environment shaped
 *    key whose value names a known mode, then any other environment shaped
 *    key
 * 3. an environment shaped key of the process env (the files are silent)
 * 4. the facts about the repository (only when NO variable names the
 *    environment at all) - a published source repository without a runtime
 *    of its own is a development checkout
 */
function determineMode(
	processVars: DotenvVar[],
	dotenvVars: DotenvVar[],
	evidence: EnvEvidence[],
	repositoryFacts: RepositoryFacts,
): WorkspaceMode {
	const resolved = resolveWorkspaceMode(processVars, dotenvVars);
	if (resolved.hint && resolved.source) {
		// The value is only kept when it is provably not a secret: the
		// dotenv files hold secrets and the evidence ends up in the agent
		// context and in the SQLite cache.
		const keepValue = canShowModeValue(
			resolved.hint.key,
			resolved.hint.value,
			resolved.source,
		);
		evidence.push({
			source: resolved.source,
			key: resolved.hint.key,
			value: keepValue ? resolved.hint.value : MASKED_MODE_VALUE,
			timestamp: Date.now(),
			file: resolved.hint.file,
		});
		// An explicit variable decides - even when it names no known mode
		// ("staging"). The mode stays unknown and the label names the value.
		return resolved.mode;
	}
	// No variable names the environment: the repository may still name it.
	const detection = modeFromRepositoryFacts(repositoryFacts);
	if (!detection) return resolved.mode;
	evidence.push({
		source: "detection",
		key: detection.key,
		value: detection.mode,
		timestamp: Date.now(),
	});
	return detection.mode;
}

/**
 * Detect and store workspace environment
 */
export function detectWorkspaceEnv(workspacePath: string): WorkspaceEnvResult {
	const now = Date.now();
	const evidence: EnvEvidence[] = [];

	// Get process.env.NODE_ENV (for build process context)
	const processVars = collectProcessEnvVars();

	// Detect RAM info
	const ramInfo = detectRamInfo();

	// Read the dotenv files of the workspace (".env" and every ".env.*").
	// The variables name the environment: NODE_ENV, another *_ENV key
	// (e.g. AMOS_ENV) or a value that names a known mode.
	const dotenvVars = collectDotenvVars(readDotenvFiles(workspacePath));

	// Check for dev/build scripts in package.json
	let hasDevScript = false;
	let hasBuildScript = false;
	const pkgJsonPath = join(workspacePath, "package.json");
	if (existsSync(pkgJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
			hasDevScript = !!(pkg.scripts && (pkg.scripts.dev || pkg.scripts.development || pkg.scripts["dev:next"]));
			hasBuildScript = !!(pkg.scripts && (pkg.scripts.build || pkg.scripts["build:next"]));
			if (hasDevScript) {
				evidence.push({
					source: "package.json",
					key: "scripts.dev",
					value: "present",
					timestamp: now,
				});
			}
		} catch {
			// Ignore parse errors
		}
	}

	// Detect package manager
	const packageManager = detectPackageManager(workspacePath);

	// Check for running dev/build processes.
	// The pattern covers the common dev commands and the framework CLIs.
	// A shell that once ran the command also matches - shells are dropped
	// from the result, and a process only counts when it runs INSIDE this
	// workspace (see detectServerStates).
	const { dev: devServerState, build: buildServerState } =
		detectServerStates(workspacePath);

	// Determine mode - NEVER assume production
	const repositoryFacts = detectRepositoryFacts(
		workspacePath,
		devServerState === "running" || buildServerState === "running",
	);
	const mode = determineMode(processVars, dotenvVars, evidence, repositoryFacts);

	// Determine build permission
	let buildAllowed = false;
	if (mode === "production") {
		buildAllowed = true; // Production build is allowed
	} else if (mode === "development") {
		// A build needs headroom, not a big machine. The low-memory warning is
		// about running a build AND a dev server in parallel; a build on its
		// own only needs enough free memory to finish.
		buildAllowed =
			ramInfo.available === null ? false : ramInfo.available >= MIN_BUILD_HEADROOM_GB;
	} else {
		buildAllowed = false; // Unknown requires investigation
	}

	// Determine low RAM warning
	const lowRamWarning = ramInfo.lowWarning;

	// Build result
	const result: WorkspaceEnvResult = {
		workspacePath,
		mode,
		evidence,
		hasDevScript,
		hasBuildScript,
		packageManager,
		devServerRunning: devServerState === "running",
		buildServerRunning: buildServerState === "running",
		devServerState,
		buildServerState,
		ramTotalGb: ramInfo.total,
		ramAvailableGb: ramInfo.available,
		ramEffectiveLimitGb: ramInfo.total, // Could be enhanced with cgroup detection
		lowRamWarning,
		buildAllowed,
		detectedAt: now,
	};

	// Store in SQLite (synchronously, exception-safe)
	let db: import("node:sqlite").DatabaseSync | null = null;
	try {
		db = initDatabase();
		if (!db) {
			// No SQLite in this runtime: the result is still correct, it is
			// just not cached.
			return result;
		}
		db.prepare(`
			INSERT OR REPLACE INTO workspace_env 
			(workspace_path, mode, evidence, has_dev_script, has_build_script, package_manager,
			 dev_server_running, build_server_running, dev_server_state, build_server_state,
			 ram_total_gb, ram_available_gb,
			 ram_effective_limit_gb, low_ram_warning, build_allowed, detected_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			workspacePath,
			mode,
			JSON.stringify(evidence),
			hasDevScript ? 1 : 0,
			hasBuildScript ? 1 : 0,
			packageManager,
			encodeServerState(devServerState),
			encodeServerState(buildServerState),
			devServerState,
			buildServerState,
			ramInfo.total,
			ramInfo.available,
			ramInfo.total,
			lowRamWarning ? 1 : 0,
			buildAllowed ? 1 : 0,
			now,
			now
		);
	} catch (err) {
		// SQLite failure - continue with in-memory result
		console.error("[WorkspaceEnv] SQLite persistence failed:", err);
	} finally {
		if (db) {
			try {
				db.close();
			} catch {
				// Ignore close errors
			}
		}
	}

	return result;
}

/**
 * Load cached workspace environment
 */
export function loadWorkspaceEnv(workspacePath: string): WorkspaceEnvResult | null {
	let db: import("node:sqlite").DatabaseSync | null = null;
	try {
		db = initDatabase();
		if (!db) return null;
		const row = db.prepare("SELECT * FROM workspace_env WHERE workspace_path = ?").get(workspacePath) as {
			workspace_path: string;
			mode: string;
			evidence: string;
			has_dev_script: number;
			has_build_script: number;
			package_manager: string | null;
			dev_server_running: number;
			build_server_running: number;
			dev_server_state: string | null;
			build_server_state: string | null;
			ram_total_gb: number | null;
			ram_available_gb: number | null;
			ram_effective_limit_gb: number | null;
			low_ram_warning: number;
			build_allowed: number;
			detected_at: number;
		} | undefined;

		if (!row) return null;

		// Check cache freshness (5 minutes for dev workspaces)
		const ageMs = Date.now() - row.detected_at;
		const MAX_CACHE_AGE_MS = 5 * 60 * 1000; // 5 minutes

		if (ageMs > MAX_CACHE_AGE_MS) {
			return null; // Cache stale
		}

		return {
			workspacePath: row.workspace_path,
			mode: row.mode as WorkspaceMode,
			evidence: JSON.parse(row.evidence || "[]"),
			hasDevScript: row.has_dev_script === 1,
			hasBuildScript: row.has_build_script === 1,
			packageManager: row.package_manager,
			devServerState: decodeServerState(
				row.dev_server_running,
				row.dev_server_state,
			),
			buildServerState: decodeServerState(
				row.build_server_running,
				row.build_server_state,
			),
			devServerRunning:
				decodeServerState(row.dev_server_running, row.dev_server_state) ===
				"running",
			buildServerRunning:
				decodeServerState(row.build_server_running, row.build_server_state) ===
				"running",
			ramTotalGb: row.ram_total_gb,
			ramAvailableGb: row.ram_available_gb,
			ramEffectiveLimitGb: row.ram_effective_limit_gb,
			lowRamWarning: row.low_ram_warning === 1,
			buildAllowed: row.build_allowed === 1,
			detectedAt: row.detected_at,
		};
	} catch {
		return null;
	} finally {
		if (db) {
			try {
				db.close();
			} catch {
				// Ignore close errors
			}
		}
	}
}

/**
 * Get or detect workspace environment
 */
export function getWorkspaceEnv(workspacePath: string): WorkspaceEnvResult {
	// Try to load cached result first
	const cached = loadWorkspaceEnv(workspacePath);
	if (cached) {
		return cached;
	}
	// Detect fresh
	return detectWorkspaceEnv(workspacePath);
}

/**
 * Revalidate workspace environment before impactful commands
 */
export function revalidateWorkspaceEnv(workspacePath: string): WorkspaceEnvResult {
	// Force fresh detection for command decisions
	return detectWorkspaceEnv(workspacePath);
}

/**
 * Format workspace env as agent-readable message
 */
export function formatEnvForAgent(workspacePath: string): string {
	return formatEnvForAgentResult(getWorkspaceEnv(workspacePath));
}

/**
 * Format workspace env as compact status line for UI
 */
export function formatEnvStatusLine(env: WorkspaceEnvResult): string {
	return formatStatusLine(env);
}

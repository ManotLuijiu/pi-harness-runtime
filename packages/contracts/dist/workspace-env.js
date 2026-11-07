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
import { dirname, join, resolve, sep } from "path";
import { platform, totalmem, freemem } from "os";
import { canShowModeValue, collectDotenvVars, collectProcessEnvVars, describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, detectModeHint, DEPLOYMENT_MARKER_FILES, filterOwnPids, formatEnvForAgentResult, formatEnvStatusLine as formatStatusLine, formatWorkspacePath, isLauncherCommand, isLowRamWarning, MASKED_MODE_VALUE, MIN_BUILD_HEADROOM_GB, modeFromFrappeBenchFacts, modeFromRepositoryFacts, modeFromValue, orderDotenvFileNames, parseDotenvVars, resolveWorkspaceMode, } from "./workspace-env-format.js";
import { readDotenvFiles } from "./workspace-dotenv.js";
const STORE_DIR = join(process.env.HOME || osHomedir(), ".pi-harness-runtime");
/**
 * Ensure store directory exists synchronously
 */
function ensureStoreDir() {
    if (!existsSync(STORE_DIR)) {
        mkdirSync(STORE_DIR, { recursive: true });
    }
}
/**
 * Get workspace database path
 */
function getDbPath() {
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
function loadDatabaseSync() {
    try {
        const require = createRequire(import.meta.url);
        return require("node:sqlite").DatabaseSync;
    }
    catch {
        return null;
    }
}
/**
 * Initialize workspace environment database
 */
function initDatabase() {
    const DatabaseSync = loadDatabaseSync();
    if (!DatabaseSync)
        return null;
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
    }
    catch {
        // The column exists already.
    }
    try {
        db.exec("ALTER TABLE workspace_env ADD COLUMN build_server_state TEXT");
    }
    catch {
        // The column exists already.
    }
    return db;
}
/**
 * The mode/evidence types and every human readable rendering of the workspace
 * environment live in workspace-env-format.ts. They are re-exported here so
 * the existing import paths keep working.
 */
export { collectDotenvVars, collectProcessEnvVars, describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, detectModeHint, formatEnvForAgentResult, formatWorkspacePath, modeFromValue, orderDotenvFileNames, parseDotenvVars, resolveWorkspaceMode, };
export { canShowModeValue, isEnvShapedKey, isSecretLikeKey, MASKED_MODE_VALUE } from "./workspace-env-format.js";
export { isTemplateDotenvName, listDotenvFiles, readDotenvFiles } from "./workspace-dotenv.js";
/**
 * Detect RAM information
 */
function detectRamInfo() {
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
    }
    catch {
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
function processExe(pid) {
    if (!/^\d+$/.test(pid))
        return "";
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
    }
    catch {
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
function isShellExe(exe) {
    return /^(sh|bash|dash|zsh|ksh|csh|fish|busybox)$/.test(exe);
}
/**
 * The parent pid of a process.
 */
function parentPid(pid) {
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
    }
    catch {
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
function ancestorPids(pid) {
    const chain = [];
    let current = pid;
    for (let depth = 0; depth < 32; depth++) {
        const parent = parentPid(current);
        if (!parent || chain.includes(parent))
            break;
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
function processScope(pid, workspacePath) {
    if (!/^\d+$/.test(pid))
        return "unknown";
    try {
        const os = platform();
        let processCwd = null;
        if (os === "linux") {
            // Linux exposes the working directory of every process.
            processCwd = readlinkSync(`/proc/${pid}/cwd`);
        }
        else if (os === "darwin") {
            const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null || true`, {
                encoding: "utf8",
                timeout: 1000,
            });
            const match = out
                .split("\n")
                .find((line) => line.startsWith("n"));
            processCwd = match ? match.slice(1) : null;
        }
        else {
            return "unknown";
        }
        if (!processCwd)
            return "unknown";
        const workspace = realpathSync(workspacePath);
        const cwd = realpathSync(processCwd);
        return cwd === workspace || cwd.startsWith(`${workspace}/`)
            ? "yes"
            : "no";
    }
    catch (error) {
        // The process is GONE (it exited between pgrep and this check) or
        // the workspace does not exist - in both cases the process cannot
        // be a server of this workspace. Only an unreadable process (for
        // example a permission error) leaves the answer unknown.
        const code = error?.code;
        if (code === "ENOENT")
            return "no";
        return "unknown";
    }
}
/**
 * The command line of a process.
 */
function processCmdline(pid) {
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
    }
    catch {
        // The process is gone or unreadable.
    }
    return "";
}
/**
 * The patterns that identify a dev server and a build server.
 */
const DEV_SERVER_PATTERN = /(next dev|nuxt|(^|[^a-z])vite([^a-z]|$)|webpack|remix dev|npm run dev|bun run dev|yarn dev|pnpm dev|npm run start|bun run start|yarn start|pnpm start)/;
const BUILD_SERVER_PATTERN = /(next build|nuxt build|webpack build|npm run build|bun run build|yarn build|pnpm build)/;
/**
 * Is a process tool available at all?
 *
 * Without one no check ran, so the state is "not checked" - never
 * "not detected" (which would claim that a check happened).
 */
function hasProcessTool() {
    try {
        execSync("command -v pgrep >/dev/null 2>&1", {
            stdio: "ignore",
            timeout: 1000,
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * The direct children of a process.
 */
function childPids(pid) {
    if (!/^\d+$/.test(pid))
        return [];
    try {
        const out = execSync(`pgrep -P ${pid} 2>/dev/null || true`, {
            encoding: "utf8",
            timeout: 500,
        });
        return out
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => /^\d+$/.test(line));
    }
    catch {
        return [];
    }
}
/**
 * Does one of the processes listen on a TCP socket?
 *
 * A listening socket is the proof that a process is a SERVER - the command
 * line alone can be anything.
 */
function hasListeningSocket(pids) {
    const safe = pids.filter((pid) => /^\d+$/.test(pid));
    if (safe.length === 0)
        return false;
    try {
        const out = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${safe.join(",")} 2>/dev/null || true`, { encoding: "utf8", timeout: 1000 });
        // The first line is the header - a socket is a line after it.
        return out.trim().split("\n").filter((line) => line.trim()).length > 1;
    }
    catch {
        return false;
    }
}
/**
 * Does a process (or one of its descendants) listen on a TCP socket?
 *
 * The levels are checked from the closest to the farthest, so a server
 * that is a direct child is found before a deep tree is walked.
 */
function familyHasListeningSocket(pid) {
    let level = [pid];
    const seen = new Set();
    for (let depth = 0; depth < 8 && level.length > 0; depth++) {
        if (hasListeningSocket(level))
            return true;
        const next = [];
        for (const current of level) {
            for (const child of childPids(current)) {
                if (seen.has(child))
                    continue;
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
function hasLsof() {
    try {
        execSync("command -v lsof >/dev/null 2>&1", { stdio: "ignore", timeout: 1000 });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Merge two answers about a server state.
 *
 * "running" wins (a server was found), then "not checked" (something
 * could not be read), then "not detected".
 */
function mergeServerState(a, b) {
    if (a === "running" || b === "running")
        return "running";
    if (a === "not-checked" || b === "not-checked")
        return "not-checked";
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
function detectServerStates(workspacePath) {
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
        const script = `echo $$; pgrep -f ${JSON.stringify(`(${DEV_SERVER_PATTERN.source})|(${BUILD_SERVER_PATTERN.source})`)} 2>/dev/null || true`;
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
        let dev = "not-detected";
        let build = "not-detected";
        for (const pid of pids) {
            const cmdline = processCmdline(pid);
            if (!cmdline)
                continue;
            // A launcher shell ("bash -c 'npm run dev'") carries the
            // pattern in its own command line and is not a server. A shell
            // that runs a SCRIPT ("./dev.sh") is a server and is kept.
            if (isShellExe(processExe(pid)) && /(^|\s)-c(\s|$)/.test(cmdline)) {
                continue;
            }
            const isDev = DEV_SERVER_PATTERN.test(cmdline);
            const isBuild = BUILD_SERVER_PATTERN.test(cmdline);
            if (!isDev && !isBuild)
                continue;
            const scope = processScope(pid, workspacePath);
            if (scope === "no")
                continue;
            if (scope === "unknown") {
                // Only the state of the pattern this process matched is
                // uncertain.
                if (isDev)
                    dev = mergeServerState(dev, "not-checked");
                if (isBuild)
                    build = mergeServerState(build, "not-checked");
                continue;
            }
            if (isLauncherCommand(cmdline)) {
                // A launcher is not the server - the server is its child.
                if (!lsofAvailable) {
                    // Without lsof it cannot be shown that a server really
                    // listens, so no running state is claimed.
                    if (isDev)
                        dev = mergeServerState(dev, "not-checked");
                    if (isBuild)
                        build = mergeServerState(build, "not-checked");
                    continue;
                }
                if (!familyHasListeningSocket(pid))
                    continue;
            }
            if (isDev)
                dev = "running";
            if (isBuild)
                build = "running";
        }
        return { dev, build };
    }
    catch {
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
function encodeServerState(state) {
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
function decodeServerState(value, state) {
    if (state === "running" || state === "not-detected" || state === "not-checked") {
        return state;
    }
    // Legacy rows: 1 = running, 0 = the old ambiguous "not running".
    if (value === 1)
        return "running";
    return "not-checked";
}
/**
 * Detect package manager from lock file
 */
function detectPackageManager(workspacePath) {
    if (existsSync(join(workspacePath, "pnpm-lock.yaml")))
        return "pnpm";
    if (existsSync(join(workspacePath, "yarn.lock")))
        return "yarn";
    if (existsSync(join(workspacePath, "package-lock.json")))
        return "npm";
    return null;
}
/**
 * The directories that never hold a repository of their own.
 *
 * A search for a repository below the workspace must not walk into a build
 * output or a dependency tree: those directories hold thousands of files and
 * no repository.
 */
const REPOSITORY_SEARCH_SKIP = new Set([
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    "out",
    "target",
    ".next",
    ".nuxt",
    ".cache",
    ".tox",
    "vendor",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
]);
/**
 * The deepest level below the workspace that is searched for a repository.
 *
 * Two levels cover the shapes that matter: a folder of applications
 * ("apps/m_capital") and a repository inside one of them ("apps/m_capital/
 * frontend" with the repository one level above).
 */
const REPOSITORY_SEARCH_DEPTH = 2;
/**
 * The most directories that are read during the search.
 *
 * The search is bounded so a workspace with many folders cannot slow the
 * startup down. A directory that holds a repository is found whatever its
 * position is, as long as the search has not read that many directories.
 */
const REPOSITORY_SEARCH_CANDIDATES = 64;
/**
 * The branch of a checkout ("" when it cannot be read).
 */
function gitBranch(directory) {
    try {
        const out = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
            cwd: directory,
            encoding: "utf8",
            timeout: 1500,
        });
        const branch = out.trim();
        // A detached HEAD reports "HEAD" - that is not a branch name.
        return branch === "HEAD" ? "" : branch;
    }
    catch {
        return "";
    }
}
/**
 * The repository of a directory, through its parents.
 */
function gitFactsIn(directory) {
    try {
        const out = execSync("git rev-parse --show-toplevel 2>/dev/null", {
            cwd: directory,
            encoding: "utf8",
            timeout: 1500,
        });
        const root = out.trim();
        if (!root)
            return { root: "", branch: "" };
        return { root, branch: gitBranch(root) };
    }
    catch {
        // No git, no repository, or a timeout: nothing is known.
        return { root: "", branch: "" };
    }
}
/**
 * The child of a workspace that holds a repository.
 *
 * A workspace is often the folder above the repository: the root of a
 * monorepo, a directory of applications, a directory of workspaces. The
 * repository of such a workspace is below it, and the search finds the
 * nearest one in a stable order.
 *
 * @param workspacePath The workspace
 * @returns The directory that holds the repository ("" when there is none)
 */
export function findRepositoryChild(workspacePath) {
    return findChildDirectory(workspacePath, (directory) => existsSync(join(directory, ".git")));
}
/**
 * The child of a workspace that matches a predicate.
 *
 * A workspace is often the folder above the repository: the root of a
 * monorepo, a directory of applications, a directory of workspaces. The
 * nearest match in a stable order is returned.
 *
 * @param workspacePath The workspace
 * @param matches The predicate of a directory
 * @returns The directory that matches ("" when there is none)
 */
export function findChildDirectory(workspacePath, matches) {
    let candidates = 0;
    let level = [workspacePath];
    for (let depth = 0; depth < REPOSITORY_SEARCH_DEPTH && level.length > 0; depth += 1) {
        const next = [];
        for (const directory of level) {
            let names;
            try {
                names = readdirSync(directory, { withFileTypes: true })
                    .filter((entry) => entry.isDirectory() && !REPOSITORY_SEARCH_SKIP.has(entry.name))
                    .map((entry) => entry.name)
                    .sort();
            }
            catch {
                // An unreadable directory proves nothing.
                continue;
            }
            for (const name of names) {
                if (candidates >= REPOSITORY_SEARCH_CANDIDATES)
                    return "";
                candidates += 1;
                const child = join(directory, name);
                if (matches(child))
                    return child;
                next.push(child);
            }
        }
        level = next;
    }
    return "";
}
/**
 * The git repository of a workspace.
 *
 * The repository is looked for in three places:
 * 1. the workspace itself - `git rev-parse` walks up, so a folder inside a
 *    repository finds the repository of its parent
 * 2. a child of the workspace, when the workspace is not in a repository
 *
 * The root of the repository is the unit of the detection: a package
 * published from a monorepo is described by the root, not by the folder
 * the harness happens to run in.
 */
function detectGitFacts(workspacePath) {
    const own = gitFactsIn(workspacePath);
    if (own.root)
        return own;
    // The workspace is not in a repository. It may hold one: a directory of
    // applications, a monorepo root.
    const child = findRepositoryChild(workspacePath);
    if (!child)
        return { root: "", branch: "" };
    return { root: child, branch: gitBranch(child) };
}
/**
 * True when the package is published to a registry.
 *
 * A package that is published names a version and declares what it ships
 * ("files", "bin" or a "publishConfig"). A repository that only holds an
 * application usually declares none of them - so this stays a careful
 * signal instead of "every package.json is published".
 */
function isPublishedPackage(packageDir) {
    const pkgJsonPath = join(packageDir, "package.json");
    if (!existsSync(pkgJsonPath))
        return false;
    try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (!pkg || typeof pkg !== "object")
            return false;
        if (pkg.private === true)
            return false;
        if (typeof pkg.name !== "string" || !pkg.name)
            return false;
        if (typeof pkg.version !== "string" || !pkg.version)
            return false;
        return (Array.isArray(pkg.files) ||
            (typeof pkg.bin === "object" && pkg.bin !== null) ||
            (typeof pkg.publishConfig === "object" && pkg.publishConfig !== null));
    }
    catch {
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
function hasDeploymentConfiguration(repoRoot) {
    for (const marker of DEPLOYMENT_MARKER_FILES) {
        if (existsSync(join(repoRoot, marker)))
            return true;
    }
    const workflowDir = join(repoRoot, ".github", "workflows");
    if (existsSync(workflowDir)) {
        try {
            for (const name of readdirSync(workflowDir)) {
                if (/deploy/i.test(name))
                    return true;
            }
        }
        catch {
            // An unreadable directory proves nothing.
        }
    }
    return false;
}
/**
 * Read the facts about the repository the workspace belongs to.
 */
function detectRepositoryFacts(workspacePath, hasRunningServer) {
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
 * The configuration file of a Frappe bench.
 *
 * The file is the marker of a bench: every bench has one, and it holds the
 * configuration that is shared by all its sites.
 */
const FRAPPE_BENCH_CONFIG = join("sites", "common_site_config.json");
/**
 * The deepest level of parents that is searched for a bench.
 */
const MAX_PARENT_DEPTH = 12;
/**
 * The directories that hold the configuration of a supervisor program group.
 */
const SUPERVISOR_CONFIG_DIRS = ["/etc/supervisor/conf.d", "/etc/supervisor"];
/**
 * The directories that hold the configuration of an nginx site.
 */
const NGINX_CONFIG_DIRS = ["/etc/nginx/conf.d", "/etc/nginx/sites-enabled"];
/**
 * The most site configurations of a bench that are read.
 */
const MAX_BENCH_SITES = 10;
/**
 * The workspace and its parents.
 *
 * The workspace of a bench is usually inside the bench (the bench holds its
 * apps), so the parents have to be searched as well.
 */
function workspaceAndParents(workspacePath) {
    const directories = [];
    let current = resolve(workspacePath);
    for (let depth = 0; depth < MAX_PARENT_DEPTH; depth += 1) {
        directories.push(current);
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return directories;
}
/**
 * A JSON file as an object (null when it cannot be read or parsed).
 */
function readJsonFile(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * A boolean field of a configuration file.
 *
 * Frappe writes "1" and "0", but a JSON file may hold a real boolean. A
 * field that is absent or holds anything else is no claim.
 */
function booleanField(config, key) {
    if (!config)
        return null;
    const value = config[key];
    if (value === true || value === 1)
        return true;
    if (value === false || value === 0)
        return false;
    return null;
}
/**
 * The sites of a bench.
 */
function frappeSiteNames(benchRoot) {
    try {
        return readdirSync(join(benchRoot, "sites"), { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .map((entry) => entry.name)
            .sort()
            .slice(0, MAX_BENCH_SITES);
    }
    catch {
        return [];
    }
}
/**
 * A site of the bench is in maintenance mode.
 */
function siteMaintenanceMode(benchRoot) {
    for (const site of frappeSiteNames(benchRoot)) {
        const config = readJsonFile(join(benchRoot, "sites", site, "site_config.json"));
        if (booleanField(config, "maintenance_mode") === true)
            return true;
    }
    return null;
}
/**
 * Does a configuration directory mention one of the needles?
 *
 * The production setup of a bench is written into the configuration of the
 * process manager (supervisor) and of the web server (nginx): those files
 * name the bench, not the other way round.
 */
function configMentions(directories, needles) {
    const wanted = needles.filter((needle) => needle.length > 0);
    if (wanted.length === 0)
        return false;
    for (const directory of directories) {
        let entries;
        try {
            entries = readdirSync(directory);
        }
        catch {
            continue;
        }
        for (const entry of entries.slice(0, 64)) {
            if (!entry.endsWith(".conf"))
                continue;
            let content;
            try {
                content = readFileSync(join(directory, entry), "utf8");
            }
            catch {
                continue;
            }
            if (wanted.some((needle) => content.includes(needle)))
                return true;
        }
    }
    return false;
}
/**
 * Does a process belong to a bench?
 *
 * The working directory of the process is the strongest evidence (Linux
 * exposes it); otherwise the command line must name the bench.
 */
function processBelongsToBench(pid, benchRoot) {
    if (platform() === "linux") {
        try {
            const cwd = readlinkSync(`/proc/${pid}/cwd`);
            return cwd === benchRoot || cwd.startsWith(benchRoot + sep);
        }
        catch {
            // The process is gone or its directory cannot be read.
        }
    }
    const cmdline = processCmdline(pid);
    return cmdline.includes(benchRoot);
}
/**
 * The processes of a bench.
 *
 * "bench serve" is the development server of a bench, "bench start" runs it
 * the way a server runs it (web, workers, scheduler).
 */
function benchProcesses(benchRoot) {
    const none = { dev: false, production: false };
    const os = platform();
    if (os !== "linux" && os !== "darwin")
        return none;
    if (!hasProcessTool())
        return none;
    try {
        const script = `echo $$; pgrep -f ${JSON.stringify("bench (serve|start)|frappe\\.serve")} 2>/dev/null || true`;
        const out = execSync(script, {
            encoding: "utf8",
            timeout: 1000,
        });
        const lines = out.split("\n");
        const ownPids = [
            String(process.pid),
            String(process.ppid),
            (lines[0] ?? "").trim(),
            ...ancestorPids(String(process.pid)),
        ];
        const pids = filterOwnPids(lines.slice(1), ownPids);
        let dev = false;
        let production = false;
        for (const pid of pids) {
            const cmdline = processCmdline(pid);
            if (!cmdline)
                continue;
            if (isShellExe(processExe(pid)) && /(^|\s)-c(\s|$)/.test(cmdline))
                continue;
            if (!processBelongsToBench(pid, benchRoot))
                continue;
            if (/frappe\.serve|bench\s+serve/.test(cmdline))
                dev = true;
            else if (/bench\s+start/.test(cmdline))
                production = true;
        }
        return { dev, production };
    }
    catch {
        return none;
    }
}
/**
 * The bench of a workspace.
 *
 * The bench is the workspace itself, one of its parents (a bench holds its
 * apps, so a workspace inside a bench is below it), or one of its children
 * (a directory of workspaces).
 */
function findFrappeBench(workspacePath) {
    for (const directory of workspaceAndParents(workspacePath)) {
        if (existsSync(join(directory, FRAPPE_BENCH_CONFIG)))
            return directory;
    }
    return findChildDirectory(workspacePath, (directory) => existsSync(join(directory, FRAPPE_BENCH_CONFIG)));
}
/**
 * The facts about the Frappe bench of a workspace.
 *
 * A bench says much more about the environment than one flag: the flag says
 * that the developer conveniences are on, the way the bench runs says
 * whether it is a development or a deployed bench.
 */
function detectFrappeBenchFacts(workspacePath, branch) {
    const facts = {
        benchRoot: "",
        developerMode: null,
        maintenanceMode: null,
        liveReload: false,
        pauseScheduler: false,
        supervisorManaged: false,
        nginxManaged: false,
        deploymentMarker: false,
        devServerRunning: false,
        productionRun: false,
        branch,
    };
    const benchRoot = findFrappeBench(workspacePath);
    if (!benchRoot)
        return facts;
    facts.benchRoot = benchRoot;
    const config = readJsonFile(join(benchRoot, FRAPPE_BENCH_CONFIG));
    facts.developerMode = booleanField(config, "developer_mode");
    facts.liveReload = booleanField(config, "live_reload") === true;
    facts.pauseScheduler = booleanField(config, "pause_scheduler") === true;
    // The common configuration may declare the maintenance mode, and a site
    // may declare it for itself.
    facts.maintenanceMode =
        booleanField(config, "maintenance_mode") === true
            ? true
            : siteMaintenanceMode(benchRoot);
    facts.deploymentMarker = hasDeploymentConfiguration(benchRoot);
    const needles = [
        benchRoot,
        ...frappeSiteNames(benchRoot).filter((site) => site.length >= 4),
    ];
    facts.supervisorManaged = configMentions(SUPERVISOR_CONFIG_DIRS, needles);
    facts.nginxManaged = configMentions(NGINX_CONFIG_DIRS, needles);
    const processes = benchProcesses(benchRoot);
    facts.devServerRunning = processes.dev;
    facts.productionRun = processes.production;
    return facts;
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
 * 4. the facts about a Frappe bench - the bench is the runtime of a site
 * 5. the facts about the repository (only when NO variable names the
 *    environment at all) - a published source repository without a runtime
 *    of its own is a development checkout
 */
function determineMode(processVars, dotenvVars, evidence, repositoryFacts, frappeBenchFacts) {
    const resolved = resolveWorkspaceMode(processVars, dotenvVars);
    if (resolved.hint && resolved.source) {
        // The value is only kept when it is provably not a secret: the
        // dotenv files hold secrets and the evidence ends up in the agent
        // context and in the SQLite cache.
        const keepValue = canShowModeValue(resolved.hint.key, resolved.hint.value, resolved.source);
        evidence.push({
            source: resolved.source,
            key: resolved.hint.key,
            value: keepValue ? resolved.hint.value : MASKED_MODE_VALUE,
            timestamp: Date.now(),
            file: resolved.hint.file,
        });
        // A variable whose value names a known mode decides.
        if (resolved.mode !== "unknown")
            return resolved.mode;
        // An explicit NODE_ENV decides even when it names no known mode
        // ("staging"). A deliberate value must not be replaced by the shape
        // of the checkout.
        if (resolved.decides === true)
            return resolved.mode;
    }
    // No variable names a known mode: the facts about the workspace may still
    // name it. A variable that names no known mode (VIRTUAL_ENV, a path) is a
    // fact about the machine, not a declaration of the environment, so it does
    // not keep the mode unknown when the checkout names it.
    // A Frappe bench comes first: the bench is the runtime of a site, so its
    // facts say more about the environment than the shape of a checkout.
    const benchDetection = modeFromFrappeBenchFacts(frappeBenchFacts);
    if (benchDetection) {
        evidence.push({
            source: "detection",
            key: benchDetection.key,
            value: benchDetection.mode,
            timestamp: Date.now(),
        });
        return benchDetection.mode;
    }
    const detection = modeFromRepositoryFacts(repositoryFacts);
    if (!detection)
        return resolved.mode;
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
export function detectWorkspaceEnv(workspacePath) {
    const now = Date.now();
    const evidence = [];
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
        }
        catch {
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
    const { dev: devServerState, build: buildServerState } = detectServerStates(workspacePath);
    // Determine mode - NEVER assume production
    const repositoryFacts = detectRepositoryFacts(workspacePath, devServerState === "running" || buildServerState === "running");
    const frappeBenchFacts = detectFrappeBenchFacts(workspacePath, repositoryFacts.branch);
    const mode = determineMode(processVars, dotenvVars, evidence, repositoryFacts, frappeBenchFacts);
    // Determine build permission
    let buildAllowed = false;
    if (mode === "production") {
        buildAllowed = true; // Production build is allowed
    }
    else if (mode === "development") {
        // A build needs headroom, not a big machine. The low-memory warning is
        // about running a build AND a dev server in parallel; a build on its
        // own only needs enough free memory to finish.
        buildAllowed =
            ramInfo.available === null ? false : ramInfo.available >= MIN_BUILD_HEADROOM_GB;
    }
    else {
        buildAllowed = false; // Unknown requires investigation
    }
    // Determine low RAM warning
    const lowRamWarning = ramInfo.lowWarning;
    // Build result
    const result = {
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
    let db = null;
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
		`).run(workspacePath, mode, JSON.stringify(evidence), hasDevScript ? 1 : 0, hasBuildScript ? 1 : 0, packageManager, encodeServerState(devServerState), encodeServerState(buildServerState), devServerState, buildServerState, ramInfo.total, ramInfo.available, ramInfo.total, lowRamWarning ? 1 : 0, buildAllowed ? 1 : 0, now, now);
    }
    catch (err) {
        // SQLite failure - continue with in-memory result
        console.error("[WorkspaceEnv] SQLite persistence failed:", err);
    }
    finally {
        if (db) {
            try {
                db.close();
            }
            catch {
                // Ignore close errors
            }
        }
    }
    return result;
}
/**
 * Load cached workspace environment
 */
export function loadWorkspaceEnv(workspacePath) {
    let db = null;
    try {
        db = initDatabase();
        if (!db)
            return null;
        const row = db.prepare("SELECT * FROM workspace_env WHERE workspace_path = ?").get(workspacePath);
        if (!row)
            return null;
        // Check cache freshness (5 minutes for dev workspaces)
        const ageMs = Date.now() - row.detected_at;
        const MAX_CACHE_AGE_MS = 5 * 60 * 1000; // 5 minutes
        if (ageMs > MAX_CACHE_AGE_MS) {
            return null; // Cache stale
        }
        return {
            workspacePath: row.workspace_path,
            mode: row.mode,
            evidence: JSON.parse(row.evidence || "[]"),
            hasDevScript: row.has_dev_script === 1,
            hasBuildScript: row.has_build_script === 1,
            packageManager: row.package_manager,
            devServerState: decodeServerState(row.dev_server_running, row.dev_server_state),
            buildServerState: decodeServerState(row.build_server_running, row.build_server_state),
            devServerRunning: decodeServerState(row.dev_server_running, row.dev_server_state) ===
                "running",
            buildServerRunning: decodeServerState(row.build_server_running, row.build_server_state) ===
                "running",
            ramTotalGb: row.ram_total_gb,
            ramAvailableGb: row.ram_available_gb,
            ramEffectiveLimitGb: row.ram_effective_limit_gb,
            lowRamWarning: row.low_ram_warning === 1,
            buildAllowed: row.build_allowed === 1,
            detectedAt: row.detected_at,
        };
    }
    catch {
        return null;
    }
    finally {
        if (db) {
            try {
                db.close();
            }
            catch {
                // Ignore close errors
            }
        }
    }
}
/**
 * Get or detect workspace environment
 */
export function getWorkspaceEnv(workspacePath) {
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
export function revalidateWorkspaceEnv(workspacePath) {
    // Force fresh detection for command decisions
    return detectWorkspaceEnv(workspacePath);
}
/**
 * Format workspace env as agent-readable message
 */
export function formatEnvForAgent(workspacePath) {
    return formatEnvForAgentResult(getWorkspaceEnv(workspacePath));
}
/**
 * Format workspace env as compact status line for UI
 */
export function formatEnvStatusLine(env) {
    return formatStatusLine(env);
}

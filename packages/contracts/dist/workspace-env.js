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
import { DatabaseSync } from "node:sqlite";
import { execSync } from "child_process";
import { existsSync, readFileSync, mkdirSync, readlinkSync, realpathSync } from "fs";
import { join } from "path";
import { platform, totalmem, freemem } from "os";
import { describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, filterOwnPids, formatEnvForAgentResult, formatEnvStatusLine as formatStatusLine, formatWorkspacePath, isLauncherCommand, } from "./workspace-env-format.js";
const STORE_DIR = join(process.env.HOME || "/home/user", ".pi-harness-runtime");
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
 * Initialize workspace environment database
 */
function initDatabase() {
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
export { describeCwdCommand, describeOs, describeServerState, describeWorkspaceMode, formatEnvForAgentResult, formatWorkspacePath, };
/**
 * Parse dotenv file without loading secrets
 * Returns only NODE_ENV value, ignoring comments and other vars
 */
function parseNodeEnvFromDotenv(content) {
    const lines = content.split("\n");
    for (const line of lines) {
        // Skip empty lines and comments
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        // Match NODE_ENV= followed by value (handle quotes, spaces)
        // Allow: NODE_ENV=development, NODE_ENV="production", NODE_ENV: development
        const match = trimmed.match(/^NODE_ENV\s*[=:]\s*['"]?([^\s'";]+)['"]?/);
        if (match) {
            return match[1];
        }
    }
    return null;
}
/**
 * Detect RAM information
 */
function detectRamInfo() {
    try {
        const totalBytes = totalmem();
        const freeBytes = freemem();
        const totalGb = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
        const availableGb = Math.round((freeBytes / (1024 ** 3)) * 10) / 10;
        const LOW_RAM_GB = 16;
        return {
            total: totalGb,
            available: availableGb,
            lowWarning: totalGb < LOW_RAM_GB || availableGb < 4,
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
 * Determine workspace mode with proper precedence
 * Never assume production - unknown requires investigation
 */
function determineMode(processEnv, dotenvNodeEnv, evidence) {
    // Explicit process.env takes highest priority (for build processes)
    if (processEnv) {
        const env = processEnv.toLowerCase();
        // The evidence is recorded for EVERY value, including one that names
        // no known mode ("staging"): the label then says which NODE_ENV could
        // not be interpreted instead of claiming there is none.
        evidence.push({
            source: "process.env",
            key: "NODE_ENV",
            value: env,
            timestamp: Date.now(),
        });
        if (env === "production") {
            return "production";
        }
        if (env === "development" || env === "dev") {
            return "development";
        }
        if (env === "test") {
            return "test";
        }
    }
    // Check dotenv file if present
    if (dotenvNodeEnv) {
        const env = dotenvNodeEnv.toLowerCase();
        evidence.push({
            source: ".env file",
            key: "NODE_ENV",
            value: env,
            timestamp: Date.now(),
        });
        if (env === "production")
            return "production";
        if (env === "development" || env === "dev")
            return "development";
        if (env === "test")
            return "test";
    }
    // Note: presence of dev script is a capability, not proof of mode
    // Mode detection requires explicit NODE_ENV
    return "unknown";
}
/**
 * Detect and store workspace environment
 */
export function detectWorkspaceEnv(workspacePath) {
    const now = Date.now();
    const evidence = [];
    // Get process.env.NODE_ENV (for build process context)
    const processNodeEnv = process.env.NODE_ENV;
    // Detect RAM info
    const ramInfo = detectRamInfo();
    // Check for .env files and parse NODE_ENV
    let dotenvNodeEnv = null;
    const dotenvFiles = [
        join(workspacePath, ".env"),
        join(workspacePath, ".env.development"),
        join(workspacePath, ".env.dev"),
    ];
    for (const envFile of dotenvFiles) {
        if (existsSync(envFile)) {
            try {
                const content = readFileSync(envFile, "utf8");
                dotenvNodeEnv = parseNodeEnvFromDotenv(content);
                if (dotenvNodeEnv) {
                    evidence.push({
                        source: ".env file",
                        key: "NODE_ENV",
                        value: dotenvNodeEnv,
                        timestamp: now,
                    });
                    break;
                }
            }
            catch {
                // Ignore read errors
            }
        }
    }
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
    const mode = determineMode(processNodeEnv, dotenvNodeEnv, evidence);
    // Determine build permission
    let buildAllowed = false;
    if (mode === "production") {
        buildAllowed = true; // Production build is allowed
    }
    else if (mode === "development") {
        buildAllowed = !ramInfo.lowWarning; // Allow if not low RAM
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

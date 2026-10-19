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
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { platform, totalmem, freemem } from "os";

const STORE_DIR = join(process.env.HOME || "/home/frappe", ".pi-harness-runtime");

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
 * Initialize workspace environment database
 */
function initDatabase(): DatabaseSync {
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
			ram_total_gb REAL,
			ram_available_gb REAL,
			ram_effective_limit_gb REAL,
			low_ram_warning INTEGER NOT NULL DEFAULT 0,
			build_allowed INTEGER NOT NULL DEFAULT -1,
			detected_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);
	return db;
}

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
 * Parse dotenv file without loading secrets
 * Returns only NODE_ENV value, ignoring comments and other vars
 */
function parseNodeEnvFromDotenv(content: string): string | null {
	const lines = content.split("\n");
	for (const line of lines) {
		// Skip empty lines and comments
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

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
		const LOW_RAM_GB = 16;

		return {
			total: totalGb,
			available: availableGb,
			lowWarning: totalGb < LOW_RAM_GB || availableGb < 4,
		};
	} catch {
		return { total: null, available: null, lowWarning: false };
	}
}

/**
 * Check if dev/build server is running
 */
function checkProcessRunning(pattern: string): boolean {
	try {
		if (platform() === "linux") {
			const { execSync } = require("child_process");
			const out = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, {
				encoding: "utf8",
				timeout: 2000,
			});
			return out.trim().split("\n").filter(Boolean).length > 0;
		} else if (platform() === "darwin") {
			const { execSync } = require("child_process");
			const out = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, {
				encoding: "utf8",
				timeout: 2000,
			});
			return out.trim().split("\n").filter(Boolean).length > 0;
		}
	} catch {
		// Process check failed - assume unknown
	}
	return false;
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
 * Determine workspace mode with proper precedence
 * Never assume production - unknown requires investigation
 */
function determineMode(
	processEnv: string | undefined,
	dotenvNodeEnv: string | null,
	evidence: EnvEvidence[]
): WorkspaceMode {
	// Explicit process.env takes highest priority (for build processes)
	if (processEnv) {
		const env = processEnv.toLowerCase();
		if (env === "production") {
			evidence.push({
				source: "process.env",
				key: "NODE_ENV",
				value: env,
				timestamp: Date.now(),
			});
			return "production";
		}
		if (env === "development" || env === "dev") {
			evidence.push({
				source: "process.env",
				key: "NODE_ENV",
				value: env,
				timestamp: Date.now(),
			});
			return "development";
		}
		if (env === "test") {
			evidence.push({
				source: "process.env",
				key: "NODE_ENV",
				value: env,
				timestamp: Date.now(),
			});
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

		if (env === "production") return "production";
		if (env === "development" || env === "dev") return "development";
		if (env === "test") return "test";
	}

	// Note: presence of dev script is a capability, not proof of mode
	// Mode detection requires explicit NODE_ENV
	return "unknown";
}

/**
 * Detect and store workspace environment
 */
export function detectWorkspaceEnv(workspacePath: string): WorkspaceEnvResult {
	const now = Date.now();
	const evidence: EnvEvidence[] = [];

	// Get process.env.NODE_ENV (for build process context)
	const processNodeEnv = process.env.NODE_ENV;

	// Detect RAM info
	const ramInfo = detectRamInfo();

	// Check for .env files and parse NODE_ENV
	let dotenvNodeEnv: string | null = null;
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
			} catch {
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
		} catch {
			// Ignore parse errors
		}
	}

	// Detect package manager
	const packageManager = detectPackageManager(workspacePath);

	// Check for running dev/build processes
	const devServerRunning = checkProcessRunning("(next dev|nuxt| vite |webpack|remix dev)");
	const buildServerRunning = checkProcessRunning("(next build|nuxt build|webpack build)");

	// Determine mode - NEVER assume production
	const mode = determineMode(processNodeEnv, dotenvNodeEnv, evidence);

	// Determine build permission
	let buildAllowed = false;
	if (mode === "production") {
		buildAllowed = true; // Production build is allowed
	} else if (mode === "development") {
		buildAllowed = !ramInfo.lowWarning; // Allow if not low RAM
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
		devServerRunning,
		buildServerRunning,
		ramTotalGb: ramInfo.total,
		ramAvailableGb: ramInfo.available,
		ramEffectiveLimitGb: ramInfo.total, // Could be enhanced with cgroup detection
		lowRamWarning,
		buildAllowed,
		detectedAt: now,
	};

	// Store in SQLite (synchronously, exception-safe)
	let db: DatabaseSync | null = null;
	try {
		db = initDatabase();
		db.prepare(`
			INSERT OR REPLACE INTO workspace_env 
			(workspace_path, mode, evidence, has_dev_script, has_build_script, package_manager,
			 dev_server_running, build_server_running, ram_total_gb, ram_available_gb,
			 ram_effective_limit_gb, low_ram_warning, build_allowed, detected_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			workspacePath,
			mode,
			JSON.stringify(evidence),
			hasDevScript ? 1 : 0,
			hasBuildScript ? 1 : 0,
			packageManager,
			devServerRunning ? 1 : 0,
			buildServerRunning ? 1 : 0,
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
	let db: DatabaseSync | null = null;
	try {
		db = initDatabase();
		const row = db.prepare("SELECT * FROM workspace_env WHERE workspace_path = ?").get(workspacePath) as {
			workspace_path: string;
			mode: string;
			evidence: string;
			has_dev_script: number;
			has_build_script: number;
			package_manager: string | null;
			dev_server_running: number;
			build_server_running: number;
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
			devServerRunning: row.dev_server_running === 1,
			buildServerRunning: row.build_server_running === 1,
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
	const env = getWorkspaceEnv(workspacePath);

	let message = `[Workspace Environment]\n`;
	message += `Mode: ${env.mode.toUpperCase()}\n`;

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

	if (env.ramTotalGb !== null) {
		const ramStr = env.ramAvailableGb !== null
			? `${env.ramAvailableGb}/${env.ramTotalGb}GB available`
			: `${env.ramTotalGb}GB total`;
		message += `RAM: ${ramStr}\n`;
		if (env.lowRamWarning) {
			message += `WARNING: Low RAM - avoid parallel build + dev\n`;
		}
	}

	message += `\n`;
	message += `Build allowed: ${env.buildAllowed ? "yes" : "no - requires explicit request"}\n`;

	if (env.mode === "unknown") {
		message += `\nNOTE: Environment unknown. Explicitly ask user before build.\n`;
	}

	return message;
}

/**
 * Format workspace env as compact status line for UI
 */
export function formatEnvStatusLine(env: WorkspaceEnvResult): string {
	const mode = env.mode.toUpperCase();
	const devStatus = env.devServerRunning ? "running" : (env.hasDevScript ? "available" : "none");
	const buildStatus = env.buildServerRunning ? "running" : (env.hasBuildScript ? "explicit request" : "none");
	const ramStr = env.ramAvailableGb !== null ? `${env.ramAvailableGb}/${env.ramTotalGb}` : "";

	let status = `Workspace: ${mode} | dev server: ${devStatus} | build: ${buildStatus}`;
	if (ramStr) {
		status += ` | RAM: ${ramStr}`;
	}

	return status;
}

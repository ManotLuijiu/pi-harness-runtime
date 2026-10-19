/**
 * Workspace Environment Detector
 *
 * Detects if the workspace is a development environment by checking:
 * 1. .env file existence and NODE_ENV value
 * 2. package.json "dev" script presence
 * 3. .env.development or .env.local files
 *
 * Stores detected environment in SQLite for agent reference.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = join(process.env.HOME || "/home/user", ".pi-harness-runtime");

/**
 * Ensure store directory exists
 */
function ensureStoreDir(): void {
	if (!existsSync(STORE_DIR)) {
		// mkdirSync is not available in all contexts, use fs promises or exec
		import("fs").then((fs) => fs.mkdirSync(STORE_DIR, { recursive: true }));
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
	const db = new DatabaseSync(getDbPath());
	db.exec(`
		CREATE TABLE IF NOT EXISTS workspace_env (
			workspace_path TEXT PRIMARY KEY,
			is_dev_env INTEGER NOT NULL DEFAULT 0,
			has_dev_script INTEGER NOT NULL DEFAULT 0,
			node_env TEXT,
			has_env_file INTEGER NOT NULL DEFAULT 0,
			ram_gb REAL,
			detected_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);
	return db;
}

/**
 * Detect RAM in GB
 */
function detectRamGb(): number | null {
	try {
		if (process.platform === "linux") {
			const meminfo = readFileSync("/proc/meminfo", "utf8");
			const match = meminfo.match(/MemTotal:\\s+(\\d+)\\s+kB/);
			if (match) {
				return Math.round((parseInt(match[1], 10) / 1024 / 1024) * 10) / 10;
			}
		} else if (process.platform === "darwin") {
			const out = require("child_process").execSync("sysctl hw.memsize", { encoding: "utf8" });
			const match = out.match(/hw\\.memsize:\\s+(\\d+)/);
			if (match) {
				return Math.round((parseInt(match[1], 10) / 1024 / 1024 / 1024) * 10) / 10;
			}
		}
	} catch {
		// Fallback: return null
	}
	return null;
}

/**
 * Detect if workspace is a dev environment
 */
export interface WorkspaceEnvResult {
	workspacePath: string;
	isDevEnv: boolean;
	hasDevScript: boolean;
	nodeEnv: string | null;
	hasEnvFile: boolean;
	ramGb: number | null;
	detectedAt: number;
}

/**
 * Detect and store workspace environment
 */
export function detectWorkspaceEnv(workspacePath: string): WorkspaceEnvResult {
	const now = Date.now();
	const ramGb = detectRamGb();

	// Check for .env files
	const hasEnvFile = existsSync(join(workspacePath, ".env")) ||
		existsSync(join(workspacePath, ".env.development")) ||
		existsSync(join(workspacePath, ".env.local")) ||
		existsSync(join(workspacePath, ".env.dev"));

	// Read NODE_ENV from .env file if present
	let nodeEnv: string | null = null;
	const envFile = join(workspacePath, ".env");
	if (existsSync(envFile)) {
		try {
			const envContent = readFileSync(envFile, "utf8");
			const match = envContent.match(/NODE_ENV=(.+)/);
			if (match) {
				nodeEnv = match[1].trim().replace(/['"]/g, "");
			}
		} catch {
			// Ignore read errors
		}
	}

	// Check for dev script in package.json
	let hasDevScript = false;
	const pkgJsonPath = join(workspacePath, "package.json");
	if (existsSync(pkgJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
			hasDevScript = !!(pkg.scripts && (pkg.scripts.dev || pkg.scripts.development));
		} catch {
			// Ignore parse errors
		}
	}

	// Determine if this is a dev environment
	// Dev env if: has .env file OR has dev script OR NODE_ENV=development
	const isDevEnv = hasEnvFile || hasDevScript || nodeEnv === "development" || nodeEnv === "dev";

	// Store in SQLite
	const db = initDatabase();
	db.prepare(`
		INSERT OR REPLACE INTO workspace_env 
		(workspace_path, is_dev_env, has_dev_script, node_env, has_env_file, ram_gb, detected_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run(workspacePath, isDevEnv ? 1 : 0, hasDevScript ? 1 : 0, nodeEnv, hasEnvFile ? 1 : 0, ramGb, now, now);

	db.close();

	return {
		workspacePath,
		isDevEnv,
		hasDevScript,
		nodeEnv,
		hasEnvFile,
		ramGb,
		detectedAt: now,
	};
}

/**
 * Load cached workspace environment
 */
export function loadWorkspaceEnv(workspacePath: string): WorkspaceEnvResult | null {
	const db = initDatabase();
	const row = db.prepare("SELECT * FROM workspace_env WHERE workspace_path = ?").get(workspacePath) as {
		workspace_path: string;
		is_dev_env: number;
		has_dev_script: number;
		node_env: string | null;
		has_env_file: number;
		ram_gb: number | null;
		detected_at: number;
	} | undefined;
	db.close();

	if (!row) return null;

	return {
		workspacePath: row.workspace_path,
		isDevEnv: row.is_dev_env === 1,
		hasDevScript: row.has_dev_script === 1,
		nodeEnv: row.node_env,
		hasEnvFile: row.has_env_file === 1,
		ramGb: row.ram_gb,
		detectedAt: row.detected_at,
	};
}

/**
 * Get or detect workspace environment
 */
export function getWorkspaceEnv(workspacePath: string): WorkspaceEnvResult {
	// Try to load cached result first
	const cached = loadWorkspaceEnv(workspacePath);
	if (cached) {
		// Check if cache is recent (within 1 hour)
		const ageMs = Date.now() - cached.detectedAt;
		if (ageMs < 60 * 60 * 1000) {
			return cached;
		}
	}
	// Detect fresh
	return detectWorkspaceEnv(workspacePath);
}

/**
 * Check if agent should prefer dev mode (no build)
 */
export function shouldUseDevMode(workspacePath: string): {
	preferDev: boolean;
	reason: string;
	ramGb: number | null;
} {
	const env = getWorkspaceEnv(workspacePath);

	// Low RAM threshold
	const LOW_RAM_GB = 16;

	if (!env.isDevEnv) {
		return {
			preferDev: false,
			reason: "Not detected as dev environment",
			ramGb: env.ramGb,
		};
	}

	if (env.ramGb !== null && env.ramGb < LOW_RAM_GB) {
		return {
			preferDev: true,
			reason: `Low RAM (${env.ramGb}GB < ${LOW_RAM_GB}GB) - avoid parallel build + dev`,
			ramGb: env.ramGb,
		};
	}

	if (env.hasDevScript) {
		return {
			preferDev: true,
			reason: `Dev script detected - hot reload available`,
			ramGb: env.ramGb,
		};
	}

	return {
		preferDev: false,
		reason: "Dev environment but no dev script found",
		ramGb: env.ramGb,
	};
}

/**
 * Format workspace env as agent-readable message
 */
export function formatEnvForAgent(workspacePath: string): string {
	const env = shouldUseDevMode(workspacePath);
	const details = getWorkspaceEnv(workspacePath);

	let message = `[Workspace Environment]\n`;
	message += `- Path: ${workspacePath}\n`;
	message += `- Detected: ${details.isDevEnv ? "Development" : "Production/Unknown"}\n`;
	message += `- Has dev script: ${details.hasDevScript ? "Yes" : "No"}\n`;
	message += `- NODE_ENV: ${details.nodeEnv || "not set"}\n`;
	message += `- Has .env file: ${details.hasEnvFile ? "Yes" : "No"}\n`;
	message += `- RAM: ${details.ramGb ? `${details.ramGb}GB` : "unknown"}\n`;
	message += `\n`;

	if (env.preferDev) {
		message += `RECOMMENDATION: Use \`dev\` mode (no build needed)\n`;
		message += `Reason: ${env.reason}\n`;
		message += `→ Run: \`bun run dev\` (or \`npm run dev\`)\n`;
		message += `→ DON'T: Run \`build\` unless explicitly requested\n`;
	} else {
		message += `RECOMMENDATION: Build may be needed\n`;
		message += `Reason: ${env.reason}\n`;
		message += `→ Use: \`bun run build\` before running\n`;
	}

	return message;
}

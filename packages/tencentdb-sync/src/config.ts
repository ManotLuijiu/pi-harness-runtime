/**
 * TencentDB Sync Config (RFC-0105/0106)
 *
 * Loads configuration from env vars or .pi/settings.json
 */

export interface SyncConfig {
	// Server connection
	serverUrl: string; // e.g., "https://your-memory-server.example.com"
	knowledgeUrl: string; // e.g., "https://your-memory-server.example.com:8424"
	userKey: string; // sk-mem-xxx
	serviceId: string; // default

	// Skills source
	skillsSource: string; // e.g., "~/frappe-bench/.claude-plugins/moocoding-skills/skills"

	// Sync options
	autoSync: boolean;
	syncIntervalMs: number;
	watchMode: boolean;
}

const DEFAULT_CONFIG: Partial<SyncConfig> = {
	serviceId: "default",
	autoSync: false,
	syncIntervalMs: 3600000, // 1 hour
	watchMode: false,
};

/**
 * Load config from environment variables
 */
export function loadConfigFromEnv(): Partial<SyncConfig> {
	return {
		serverUrl: process.env.TENANTDB_URL || process.env.MEMORY_SERVER_URL,
		knowledgeUrl: process.env.TENANTDB_KNOWLEDGE_URL,
		userKey: process.env.TENANTDB_USER_KEY || process.env.TENANTDB_KEY,
		serviceId: process.env.TENANTDB_SERVICE_ID || "default",
		skillsSource: process.env.TENANTDB_SKILLS_SOURCE,
		autoSync: process.env.TENANTDB_AUTO_SYNC === "true",
		syncIntervalMs: process.env.TENANTDB_SYNC_INTERVAL
			? parseInt(process.env.TENANTDB_SYNC_INTERVAL) * 1000
			: undefined,
	};
}

/**
 * Load config from .pi/settings.json
 */
export async function loadConfigFromSettings(): Promise<Partial<SyncConfig>> {
	const fs = await import("node:fs");
	const path = await import("node:path");
	const homedir = process.env.HOME || process.env.USERPROFILE || "~";

	const settingsPath = path.join(homedir, ".pi", "settings.json");

	if (!fs.existsSync(settingsPath)) {
		return {};
	}

	try {
		const content = fs.readFileSync(settingsPath, "utf-8");
		const settings = JSON.parse(content);

		if (settings.tencentdb) {
			return {
				serverUrl: settings.tencentdb.url || settings.tencentdb.serverUrl,
				knowledgeUrl: settings.tencentdb.knowledgeUrl,
				userKey: settings.tencentdb.userKey || settings.tencentdb.key,
				serviceId: settings.tencentdb.serviceId || "default",
				skillsSource: settings.tencentdb.skillsSource,
				autoSync: settings.tencentdb.autoSync,
				syncIntervalMs: settings.tencentdb.syncIntervalMs
					? settings.tencentdb.syncIntervalMs * 1000
					: undefined,
			};
		}
	} catch {
		// Ignore parse errors
	}

	return {};
}

/**
 * Merge configs (env > settings > defaults)
 */
export async function loadConfig(): Promise<SyncConfig> {
	const defaults = DEFAULT_CONFIG;
	const fromSettings = await loadConfigFromSettings();
	const fromEnv = loadConfigFromEnv();

	// Knowledge URL defaults to serverUrl if not specified
	const serverUrl = fromEnv.serverUrl || fromSettings.serverUrl || "";
	const knowledgeUrl =
		fromEnv.knowledgeUrl ||
		fromSettings.knowledgeUrl ||
		`${serverUrl.replace(/:\d+$/, "")}:8424`;

	return {
		serverUrl,
		knowledgeUrl,
		userKey: fromEnv.userKey || fromSettings.userKey || "",
		serviceId: fromEnv.serviceId || fromSettings.serviceId || "default",
		skillsSource: fromEnv.skillsSource || fromSettings.skillsSource || "",
		autoSync: fromEnv.autoSync ?? fromSettings.autoSync ?? defaults.autoSync!,
		syncIntervalMs:
			fromEnv.syncIntervalMs ||
			fromSettings.syncIntervalMs ||
			defaults.syncIntervalMs!,
		watchMode:
			fromEnv.watchMode ?? fromSettings.watchMode ?? defaults.watchMode!,
	};
}

/**
 * Validate config
 */
export function validateConfig(config: SyncConfig): string[] {
	const errors: string[] = [];

	if (!config.serverUrl) {
		errors.push("TENANTDB_URL is required (set env var or .pi/settings.json)");
	}

	if (!config.userKey) {
		errors.push(
			"TENANTDB_USER_KEY is required (set env var or .pi/settings.json)",
		);
	}

	if (!config.skillsSource) {
		errors.push(
			"TENANTDB_SKILLS_SOURCE is required (set env var or .pi/settings.json)",
		);
	}

	return errors;
}

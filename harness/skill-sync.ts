/**
 * Skill Sync Service — RFC-0106
 *
 * Syncs skills from Skills SaaS backend and registers them with local registry.
 * Falls back gracefully if backend is unavailable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
	SkillInfo,
	GetSkillResult,
} from "../packages/skill-mcp-client/src/types.js";
import { SkillAPIError } from "../packages/skill-mcp-client/src/errors.js";

type SkillMCPClient = InstanceType<
	typeof import("../packages/skill-mcp-client/src/client.js").SkillMCPClient
>;

// Lazy import to avoid errors if package not built yet
let clientInstance: SkillMCPClient | null = null;

async function getClient(): Promise<SkillMCPClient | null> {
	if (!process.env.SKILLS_SAAS_API_KEY) {
		return null;
	}

	if (clientInstance) {
		return clientInstance;
	}

	try {
		const mod = await import("../packages/skill-mcp-client/src/client.js");
		const SkillMCPClientClass = mod.SkillMCPClient;
		const serverUrl =
			process.env.SKILLS_SAAS_URL || "https://api.skills.bunchee.online";

		clientInstance = new SkillMCPClientClass({
			serverUrl,
			apiKey: process.env.SKILLS_SAAS_API_KEY,
			timeoutMs: 5000,
		});
		return clientInstance;
	} catch {
		console.warn("[skill-sync] Failed to import skill-mcp-client");
		return null;
	}
}

// Cache directory
const CACHE_DIR = join(homedir(), ".pi", "skills-cache");
const CACHE_FILE = join(CACHE_DIR, "skills-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheData {
	skills: SkillInfo[];
	cachedAt: string;
	version: string;
}

interface SkillSyncResult {
	success: boolean;
	skillCount: number;
	source: "saas" | "cache" | "none";
	error?: string;
}

/**
 * Get cached skills from local disk
 */
function getCachedSkills(): CacheData | null {
	try {
		if (!existsSync(CACHE_FILE)) {
			return null;
		}

		const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as CacheData;
		const age = Date.now() - new Date(data.cachedAt).getTime();

		if (age > CACHE_TTL_MS) {
			return null; // Cache expired
		}

		return data;
	} catch {
		return null;
	}
}

/**
 * Save skills to local cache
 */
function saveCache(data: CacheData): void {
	try {
		if (!existsSync(CACHE_DIR)) {
			mkdirSync(CACHE_DIR, { recursive: true });
		}
		writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
	} catch {
		console.warn("[skill-sync] Failed to save cache");
	}
}

/**
 * Fetch and cache skills from SaaS backend
 */
async function fetchFromSaaS(): Promise<CacheData | null> {
	const client = await getClient();
	if (!client) {
		return null;
	}

	try {
		const result = await client.listSkills({ limit: 100 });
		const cacheData: CacheData = {
			skills: result.skills,
			cachedAt: new Date().toISOString(),
			version: "1.0.0",
		};
		saveCache(cacheData);
		return cacheData;
	} catch (error) {
		if (error instanceof SkillAPIError) {
			console.warn(
				`[skill-sync] API error: ${error.message} (code: ${error.code})`,
			);
		} else {
			console.warn("[skill-sync] Failed to fetch from SaaS");
		}
		return null;
	}
}

/**
 * Sync skills from SaaS backend (RFC-0106)
 *
 * Flow:
 * 1. Check cache first
 * 2. If cache valid, return cached
 * 3. If cache expired or missing, fetch from SaaS
 * 4. If SaaS fails, return empty array (graceful degradation)
 *
 * @param options.forceRefresh - Force refresh from SaaS
 * @returns Skills list (may be empty if backend unavailable)
 */
export async function syncSkillsFromSaaS(
	options: { forceRefresh?: boolean } = {},
): Promise<SkillSyncResult> {
	// Check if API key is configured
	if (!process.env.SKILLS_SAAS_API_KEY) {
		return {
			success: true,
			skillCount: 0,
			source: "none",
			error: "SKILLS_SAAS_API_KEY not configured",
		};
	}

	// Check cache first (unless force refresh)
	if (!options.forceRefresh) {
		const cached = getCachedSkills();
		if (cached) {
			return {
				success: true,
				skillCount: cached.skills.length,
				source: "cache",
			};
		}
	}

	// Fetch from SaaS
	const data = await fetchFromSaaS();
	if (data) {
		return {
			success: true,
			skillCount: data.skills.length,
			source: "saas",
		};
	}

	// SaaS failed, try to use stale cache
	const staleCache = getCachedSkills();
	if (staleCache) {
		return {
			success: true,
			skillCount: staleCache.skills.length,
			source: "cache",
			error: "Using stale cache (SaaS unavailable)",
		};
	}

	// Everything failed, return empty
	return {
		success: true,
		skillCount: 0,
		source: "none",
		error: "Could not reach Skills SaaS backend",
	};
}

/**
 * Get full skill prompt by slug or id
 *
 * Returns null if skill not found or backend unavailable
 */
export async function getSkillFromSaaS(identifier: {
	slug?: string;
	id?: string;
}): Promise<GetSkillResult | null> {
	const client = await getClient();
	if (!client) {
		return null;
	}

	try {
		return await client.getSkill(identifier);
	} catch (error) {
		if (error instanceof SkillAPIError) {
			console.warn(`[skill-sync] Failed to get skill: ${error.message}`);
		}
		return null;
	}
}

/**
 * Check if skill sync is configured
 */
export function isSkillSyncConfigured(): boolean {
	return !!process.env.SKILLS_SAAS_API_KEY;
}

/**
 * Get sync status info
 */
export function getSyncStatus(): {
	configured: boolean;
	cacheValid: boolean;
	cachedSkills: number;
} {
	const cache = getCachedSkills();
	return {
		configured: isSkillSyncConfigured(),
		cacheValid: !!cache,
		cachedSkills: cache?.skills.length ?? 0,
	};
}

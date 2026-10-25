/**
 * Skill Sync Service — RFC-0106
 *
 * Syncs skills from Skills SaaS backend and registers them with local registry.
 * Falls back gracefully if backend is unavailable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
	SkillInfo,
	GetSkillResult,
} from "../packages/skill-mcp-client/src/types.js";
import { SkillAPIError } from "../packages/skill-mcp-client/dist/errors.js";
import { atomicWriteFileSync } from "../packages/cookie-sanitizer/dist/index.js";
import { centralWarn } from "../packages/logging/dist/index.js";

type SkillMCPClient = InstanceType<
	typeof import("../packages/skill-mcp-client/dist/client.js").SkillMCPClient
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
		const mod = await import("../packages/skill-mcp-client/dist/client.js");
		const SkillMCPClientClass = mod.SkillMCPClient;
		const serverUrl = await getSkillsSaasUrl();

		async function getSkillsSaasUrl(): Promise<string> {
			if (process.env.SKILLS_SAAS_URL) return process.env.SKILLS_SAAS_URL;
			try {
				const { readFileSync, existsSync } = await import("node:fs");
				const keyFile = `${process.env.HOME}/.pi-harness-runtime/keys/skills-saas-url.txt`;
				if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
			} catch {}
			return "https://api.skills.example.com";
		}

		clientInstance = new SkillMCPClientClass({
			serverUrl,
			apiKey: process.env.SKILLS_SAAS_API_KEY,
			timeoutMs: 5000,
		});
		return clientInstance;
	} catch {
		centralWarn(
			"harness.skill-sync",
			"service.sync-failed",
			"the skill client package could not be loaded",
		);
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
	/**
	 * The skills the service holds.
	 *
	 * The list is carried along with the count, so a caller that needs
	 * the skills does not have to ask the service a second time.
	 */
	skills?: SkillInfo[];
	/**
	 * Why the service could not be reached.
	 *
	 * "denied" means the service ANSWERED and refused the call - the
	 * token is missing or the plan does not cover the skill. That is a
	 * different situation than a service that could not be reached at
	 * all, and the user needs a different fix for each.
	 */
	failure?: "denied" | "unavailable";
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
		// The write is atomic: a crash in the middle leaves the previous
		// cache intact instead of a half written file.
		atomicWriteFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
	} catch {
		centralWarn(
			"harness.skill-sync",
			"service.cache-write-failed",
			"the skill cache could not be written",
		);
	}
}

/**
 * Fetch and cache skills from SaaS backend
 */
async function fetchFromSaaS(): Promise<{
	data: CacheData | null;
	failure?: "denied" | "unavailable";
}> {
	const client = await getClient();
	if (!client) {
		return { data: null, failure: "unavailable" };
	}

	try {
		const result = await client.listSkills({ limit: 100 });
		const cacheData: CacheData = {
			skills: result.skills,
			cachedAt: new Date().toISOString(),
			version: "1.0.0",
		};
		saveCache(cacheData);
		return { data: cacheData };
	} catch (error) {
		if (error instanceof SkillAPIError) {
			centralWarn(
				"harness.skill-sync",
				"service.sync-failed",
				`the skill service answered with an error (code ${error.code})`,
			);
			// The service answered and refused the call.
			if (error.isAuthError() || error.isTierRestricted()) {
				return { data: null, failure: "denied" };
			}
		} else {
			centralWarn(
				"harness.skill-sync",
				"service.sync-failed",
				"the skill service could not be reached",
			);
		}
		return { data: null, failure: "unavailable" };
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
			skills: [],
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
				skills: cached.skills,
			};
		}
	}

	// Fetch from SaaS
	const fetched = await fetchFromSaaS();
	if (fetched.data) {
		return {
			success: true,
			skillCount: fetched.data.skills.length,
			source: "saas",
			skills: fetched.data.skills,
		};
	}

	// SaaS failed, try to use stale cache
	const staleCache = getCachedSkills();
	if (staleCache) {
		return {
			success: true,
			skillCount: staleCache.skills.length,
			source: "cache",
			skills: staleCache.skills,
			error: "Using stale cache (SaaS unavailable)",
			failure: fetched.failure,
		};
	}

	// Everything failed, return empty
	return {
		success: false,
		skillCount: 0,
		source: "none",
		skills: [],
		error:
			fetched.failure === "denied"
				? "The skill service refused the call - the token or the plan does not allow it"
				: "Could not reach Skills SaaS backend",
		failure: fetched.failure,
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
			centralWarn(
				"harness.skill-sync",
				"service.skill-fetch-failed",
				`the skill service could not deliver a skill (code ${error.code})`,
			);
		}
		return null;
	}
}

/**
 * Check if skill sync is configured
 */
export function isSkillSyncConfigured(): boolean {
	return Boolean(process.env.SKILLS_SAAS_API_KEY);
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
		cacheValid: Boolean(cache),
		cachedSkills: cache?.skills.length ?? 0,
	};
}

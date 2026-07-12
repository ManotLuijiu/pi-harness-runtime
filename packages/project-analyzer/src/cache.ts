/**
 * Cache Management
 *
 * Provides caching functionality for project analysis results.
 * Caches are keyed by repository revision and configuration file hashes.
 */

import { createHash } from "node:crypto";
import {
	readFile,
	writeFile,
	mkdir,
	stat,
	access,
	constants,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import type { CacheEntry, CacheKey, ProjectProfile } from "./types.js";

/**
 * Default cache directory.
 */
const DEFAULT_CACHE_DIR = join(
	process.env.HOME || "/tmp",
	".pi",
	"harness",
	"analyzer-cache",
);

/**
 * Cache options.
 */
export interface CacheOptions {
	/** Cache directory path */
	cacheDir?: string;
	/** Maximum age in milliseconds before cache is considered stale */
	maxAgeMs?: number;
	/** Whether to use cache */
	enabled?: boolean;
}

/**
 * Cache manager for project analysis.
 */
export class AnalysisCache {
	private cacheDir: string;
	private maxAgeMs: number;
	private enabled: boolean;

	constructor(options: CacheOptions = {}) {
		this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
		this.maxAgeMs = options.maxAgeMs || 24 * 60 * 60 * 1000; // 24 hours
		this.enabled = options.enabled !== false;
	}

	/**
	 * Generate cache key from request parameters.
	 */
	generateKey(
		repositoryRoot: string,
		revision: string,
		configHash: string,
	): CacheKey {
		return {
			repositoryRoot,
			revision,
			configHash,
		};
	}

	/**
	 * Get cache file path for a key.
	 */
	private getCachePath(key: CacheKey): string {
		// Create a safe filename from the key
		const safeRoot = key.repositoryRoot
			.replace(/[^a-zA-Z0-9]/g, "_")
			.slice(0, 50);
		const safeRevision = key.revision.slice(0, 12);
		const safeHash = key.configHash.slice(0, 12);

		return join(this.cacheDir, `${safeRoot}_${safeRevision}_${safeHash}.json`);
	}

	/**
	 * Calculate hash of content.
	 */
	calculateHash(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Calculate combined hash from multiple files.
	 */
	async calculateConfigHash(
		files: { path: string; content: string }[],
	): Promise<string> {
		const combined = files
			.map((f) => `${f.path}:${this.calculateHash(f.content)}`)
			.sort()
			.join("|");

		return this.calculateHash(combined);
	}

	/**
	 * Get cached analysis if available and fresh.
	 */
	async get(key: CacheKey): Promise<ProjectProfile | null> {
		if (!this.enabled) return null;

		const cachePath = this.getCachePath(key);

		try {
			await access(cachePath, constants.R_OK);
			const statResult = await stat(cachePath);

			// Check if cache is too old
			const age = Date.now() - statResult.mtimeMs;
			if (age > this.maxAgeMs) {
				return null;
			}

			const content = await readFile(cachePath, "utf-8");
			const entry: CacheEntry = JSON.parse(content);

			// Verify revision matches
			if (entry.revision !== key.revision) {
				return null;
			}

			// Verify config hash matches
			if (entry.configHash !== key.configHash) {
				return null;
			}

			return entry.profile;
		} catch {
			// Cache miss or error
			return null;
		}
	}

	/**
	 * Store analysis in cache.
	 */
	async set(
		key: CacheKey,
		profile: ProjectProfile,
		hashes: {
			ruleHash: string;
			manifestHash: string;
			configHash: string;
		},
	): Promise<void> {
		if (!this.enabled) return;

		const cachePath = this.getCachePath(key);

		const entry: CacheEntry = {
			profile,
			ruleHash: hashes.ruleHash,
			manifestHash: hashes.manifestHash,
			configHash: hashes.configHash,
			revision: key.revision,
			cachedAt: new Date().toISOString(),
		};

		try {
			// Ensure cache directory exists
			await mkdir(dirname(cachePath), { recursive: true });

			await writeFile(cachePath, JSON.stringify(entry, null, 2), "utf-8");
		} catch {
			// Cache write failure - non-fatal
		}
	}

	/**
	 * Invalidate cache for a specific repository.
	 */
	async invalidate(repositoryRoot: string): Promise<void> {
		if (!this.enabled) return;

		try {
			const { readdir, rm } = await import("node:fs/promises");

			const files = await readdir(this.cacheDir);
			const safeRoot = repositoryRoot
				.replace(/[^a-zA-Z0-9]/g, "_")
				.slice(0, 50);

			for (const file of files) {
				if (file.startsWith(safeRoot)) {
					await rm(join(this.cacheDir, file));
				}
			}
		} catch {
			// Invalidation failure - non-fatal
		}
	}

	/**
	 * Clear all cached analyses.
	 */
	async clear(): Promise<void> {
		if (!this.enabled) return;

		try {
			const { readdir, rm } = await import("node:fs/promises");

			const files = await readdir(this.cacheDir);
			for (const file of files) {
				if (file.endsWith(".json")) {
					await rm(join(this.cacheDir, file));
				}
			}
		} catch {
			// Clear failure - non-fatal
		}
	}

	/**
	 * Get cache statistics.
	 */
	async getStats(): Promise<{
		entryCount: number;
		totalSize: number;
		oldestEntry: string | null;
		newestEntry: string | null;
	}> {
		const stats = {
			entryCount: 0,
			totalSize: 0,
			oldestEntry: null as string | null,
			newestEntry: null as string | null,
		};

		if (!this.enabled) return stats;

		try {
			const { readdir } = await import("node:fs/promises");
			const files = await readdir(this.cacheDir);

			for (const file of files) {
				if (file.endsWith(".json")) {
					const filePath = join(this.cacheDir, file);
					const statResult = await stat(filePath);

					stats.entryCount++;
					stats.totalSize += statResult.size;

					const isoDate = statResult.mtime.toISOString();
					if (!stats.oldestEntry || isoDate < stats.oldestEntry) {
						stats.oldestEntry = isoDate;
					}
					if (!stats.newestEntry || isoDate > stats.newestEntry) {
						stats.newestEntry = isoDate;
					}
				}
			}
		} catch {
			// Stats failure - return partial
		}

		return stats;
	}
}

/**
 * Create a hash of rule files for cache invalidation.
 */
export async function hashRuleFiles(
	files: { path: string; content: string }[],
): Promise<string> {
	const combined = files
		.map(
			(f) =>
				`${f.path}:${createHash("sha256").update(f.content).digest("hex")}`,
		)
		.sort()
		.join("|");

	return createHash("sha256").update(combined).digest("hex");
}

/**
 * Create a hash of package manifests for cache invalidation.
 */
export async function hashManifestFiles(
	files: { path: string; content: string }[],
): Promise<string> {
	// For manifests, only hash the relevant parts (scripts, dependencies)
	const relevant = files
		.map((f) => {
			try {
				const parsed = JSON.parse(f.content);
				const relevant = {
					scripts: parsed.scripts,
					dependencies: parsed.dependencies,
					devDependencies: parsed.devDependencies,
				};
				return `${f.path}:${createHash("sha256").update(JSON.stringify(relevant)).digest("hex")}`;
			} catch {
				return `${f.path}:${createHash("sha256").update(f.content).digest("hex")}`;
			}
		})
		.sort()
		.join("|");

	return createHash("sha256").update(relevant).digest("hex");
}

/**
 * Create a hash of framework configuration files for cache invalidation.
 */
export async function hashFrameworkConfigFiles(
	files: { path: string; content: string }[],
): Promise<string> {
	const combined = files
		.map(
			(f) =>
				`${f.path}:${createHash("sha256").update(f.content).digest("hex")}`,
		)
		.sort()
		.join("|");

	return createHash("sha256").update(combined).digest("hex");
}

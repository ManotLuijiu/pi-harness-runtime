/**
 * OKF Loader - Loads user knowledge from ~/.pi/okf/
 *
 * This module provides optional knowledge loading for context compilation.
 * If the OKF directory doesn't exist, compilation proceeds without error.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const DEFAULT_OKF_PATH = join(homedir(), ".pi", "okf");

export interface OkfConcept {
	id: string;
	kind: "okf_concept";
	source: string;
	content: string;
	required: false;
	priority: 1;
	updatedAt: string;
	trust: "authoritative" | "generated" | "unverified";
}

/**
 * Load OKF concepts from ~/.pi/okf/ directory.
 *
 * Each .md file becomes one OKF concept.
 * If directory doesn't exist, returns empty array (graceful degradation).
 */
export function loadOkfConcepts(
	okfPath: string = DEFAULT_OKF_PATH,
): OkfConcept[] {
	// Graceful: if directory doesn't exist, return empty
	if (!existsSync(okfPath)) {
		return [];
	}

	try {
		const files = readdirSync(okfPath);
		const concepts: OkfConcept[] = [];

		for (const file of files) {
			if (!file.endsWith(".md") && !file.endsWith(".txt")) {
				continue;
			}

			const filePath = join(okfPath, file);
			const content = readFileSync(filePath, "utf-8");
			const id = basename(file, ".md").replace(/[^a-zA-Z0-9_-]/g, "_");

			concepts.push({
				id,
				kind: "okf_concept",
				source: filePath,
				content,
				required: false, // OKF is always optional
				priority: 1,
				updatedAt: new Date().toISOString(),
				trust: "authoritative", // User's own OKF is authoritative
			});
		}

		return concepts;
	} catch (error) {
		// Graceful: if read fails, log and continue
		console.warn(`[OKF] Failed to load from ${okfPath}:`, error);
		return [];
	}
}

/**
 * Check if OKF directory exists (for informational purposes).
 */
export function okfDirectoryExists(
	okfPath: string = DEFAULT_OKF_PATH,
): boolean {
	return existsSync(okfPath);
}

/**
 * Get the default OKF path.
 */
export function getOkfPath(): string {
	return DEFAULT_OKF_PATH;
}

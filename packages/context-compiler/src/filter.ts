/**
 * Context Compiler - Policy Filter
 *
 * Enforces deny patterns and size limits before any other processing.
 * This runs first so denied content never reaches the cache.
 */

import type { ContextCandidate, ContextPolicy } from "./types.js";
import { DEFAULT_POLICY } from "./types.js";

/**
 * Merge user policy with defaults.
 */
export function mergePolicy(user?: Partial<ContextPolicy>): ContextPolicy {
	if (!user) return { ...DEFAULT_POLICY };
	return {
		deny: user.deny ?? DEFAULT_POLICY.deny,
		allowLargeFiles: user.allowLargeFiles ?? DEFAULT_POLICY.allowLargeFiles,
		maxFileBytes: user.maxFileBytes ?? DEFAULT_POLICY.maxFileBytes,
		trustThreshold: user.trustThreshold,
	};
}

/**
 * Apply policy filters to candidates.
 * Denied and oversized candidates are marked as omitted.
 * This is the first stage — nothing else runs before this.
 *
 * @returns [passed, denied] - denied candidates with policy_denied reason
 */
export function applyPolicyFilter(
	candidates: ContextCandidate[],
	policy: ContextPolicy,
): {
	passed: ContextCandidate[];
	denied: Array<{ candidate: ContextCandidate; reason: string }>;
} {
	const passed: ContextCandidate[] = [];
	const denied: Array<{ candidate: ContextCandidate; reason: string }> = [];

	for (const candidate of candidates) {
		// Check deny patterns
		const denyReason = matchesDenyPattern(candidate, policy.deny);
		if (denyReason) {
			denied.push({ candidate, reason: denyReason });
			continue;
		}

		// Check file size limit
		if (candidate.filePath && candidate.content.length > policy.maxFileBytes) {
			if (!policy.allowLargeFiles) {
				denied.push({
					candidate,
					reason: `file exceeds ${policy.maxFileBytes} bytes`,
				});
				continue;
			}
		}

		// Check trust threshold
		if (
			policy.trustThreshold &&
			!meetsTrustThreshold(candidate.trust, policy.trustThreshold)
		) {
			denied.push({
				candidate,
				reason: `trust level "${candidate.trust}" below threshold`,
			});
			continue;
		}

		passed.push(candidate);
	}

	return { passed, denied };
}

/**
 * Check if a candidate matches any deny glob pattern.
 */
function matchesDenyPattern(
	candidate: ContextCandidate,
	denyPatterns: string[],
): string | null {
	const path = candidate.filePath ?? candidate.source;

	for (const pattern of denyPatterns) {
		if (globMatch(pattern, path)) {
			return `denied by pattern: ${pattern}`;
		}
	}

	return null;
}

// Simple glob matching for **/*.env style patterns.
// Handles: *, **, and literal path separators.
function globMatch(pattern: string, path: string): boolean {
	// Normalize: ensure we match relative paths like .env or /project/.env
	const normalizedPath = path.replace(/^\.\//, "");
	const normalizedPattern = pattern.replace(/^\*\//, "**/");

	if (normalizedPattern === "**") return true;

	// Convert glob to regex
	const regexStr = normalizedPattern
		.replace(/\./g, "\\.") // escape dots
		.replace(/\*\*/g, "{{DOUBLE_STAR}}")
		.replace(/\*/g, "[^/]*")
		.replace(/\{\{DOUBLE_STAR\}\}/g, ".*")
		.replace(/\?/g, "."); // single char

	try {
		const regex = new RegExp(`^${regexStr}$`);
		return regex.test(normalizedPath) || regex.test(`/${normalizedPath}`);
	} catch {
		return false;
	}
}

/**
 * Check if candidate trust meets the threshold.
 * "authoritative" > "generated" > "unverified"
 */
function meetsTrustThreshold(
	trust: ContextCandidate["trust"],
	threshold: ContextCandidate["trust"],
): boolean {
	const levels: Record<ContextCandidate["trust"], number> = {
		authoritative: 3,
		generated: 2,
		unverified: 1,
	};
	return levels[trust] >= levels[threshold];
}

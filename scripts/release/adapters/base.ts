/**
 * Base release adapter interface.
 *
 * All stack-specific adapters implement this interface.
 * The detector picks the right adapter(s) for the repo.
 */

export interface AdapterContext {
	/** Absolute path to the repo root */
	repoRoot: string;
	/** Dry-run mode — describe actions without executing */
	dryRun: boolean;
	/** Verbose output */
	verbose: boolean;
}

export interface VersionManifest {
	/** Path relative to repoRoot */
	path: string;
	/** Current version string (read from file) */
	version: string;
	/** Raw content (for re-serialization) */
	content: string;
}

export interface BumpResult {
	/** The new version after bumping */
	newVersion: string;
	/** All manifests that were updated */
	updated: VersionManifest[];
	/** Description of what was done */
	actions: string[];
}

export interface VerificationResult {
	/** True if verification passed */
	ok: boolean;
	/** List of issues found */
	errors: string[];
	/** Warnings that don't block release */
	warnings: string[];
}

/**
 * Stack-specific release adapter.
 *
 * Each adapter:
 * 1. Knows which files to inspect/update for its stack
 * 2. Provides version reading/writing
 * 3. Provides bump logic (patch/minor/major/custom)
 * 4. Provides verification rules
 */
export interface ReleaseAdapter {
	/** Unique identifier for this adapter */
	id: string;

	/** Human-readable name */
	name: string;

	/**
	 * Detect whether this adapter applies to the given repo.
	 * Return a confidence score 0-1. Higher = more confident.
	 */
	detect(ctx: AdapterContext): number;

	/**
	 * Read all version manifests for this stack.
	 * Returns empty array if no manifests found.
	 */
	readManifests(ctx: AdapterContext): Promise<VersionManifest[]>;

	/**
	 * Bump version in all relevant manifests.
	 * Returns the new version and list of updated files.
	 */
	bump(
		ctx: AdapterContext,
		bumpType: "patch" | "minor" | "major" | "prerelease",
		newVersion?: string,
	): Promise<BumpResult>;

	/**
	 * Verify that all manifests are consistent and release is safe.
	 * Should check: versions match, required files exist, tag is correct.
	 */
	verify(
		ctx: AdapterContext,
		expectedVersion: string,
	): Promise<VerificationResult>;

	/**
	 * Get the canonical version from the most authoritative manifest.
	 */
	getCanonicalVersion(ctx: AdapterContext): Promise<string | null>;
}

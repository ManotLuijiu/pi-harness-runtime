#!/usr/bin/env bun
/**
 * Release all workspace packages at the same version.
 *
 * Uses the adapter-based release orchestrator:
 * 1. Detects which stack applies (Node/monorepo, Tauri, Rust, Python)
 * 2. Syncs all manifest versions (adapter-specific) - NO standard-version here!
 * 3. Verifies consistency
 * 4. Push commit with version bump
 *
 * IMPORTANT: standard-version runs in CI (release.yml), not here!
 * This script only bumps versions and pushes - CI creates the tag.
 *
 * Usage:
 *   bun scripts/release-all.ts              # bump patch
 *   bun scripts/release-all.ts --release-as minor
 *   bun scripts/release-all.ts --release-as 0.9.0
 *   bun scripts/release-all.ts --dry-run
 *   bun scripts/release-all.ts --detect     # show detected stack, no changes
 */

import { release, detect } from "./release/orchestrator.ts";

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	// --detect: show detection only, no changes
	if (args.includes("--detect")) {
		const result = detect({ verbose: true });
		console.log(result);
		return;
	}

	// Parse release type
	const isDryRun = args.includes("--dry-run");
	const releaseArgs = args.filter((a) => a !== "--dry-run");
	const cmdParts = releaseArgs.filter(
		(a) => !a.startsWith("--dry-run") && !a.startsWith("--"),
	);

	let bumpType: "patch" | "minor" | "major" | "prerelease" = "patch";
	let newVersion: string | undefined;

	// Detect --release-as X.Y.Z vs --release-as minor/patch/major
	const releaseAsArg = cmdParts.find((a) => a.startsWith("--release-as="));
	const releaseAsIdx = cmdParts.indexOf("--release-as");
	if (releaseAsArg) {
		const val = releaseAsArg.split("=")[1];
		if (/^\d+\.\d+\.\d+/.test(val)) {
			newVersion = val;
		} else {
			bumpType = val as typeof bumpType;
		}
	} else if (releaseAsIdx >= 0) {
		const val = cmdParts[releaseAsIdx + 1];
		if (val && /^\d+\.\d+\.\d+/.test(val)) {
			newVersion = val;
		} else if (val) {
			bumpType = val as typeof bumpType;
		}
	}

	// Skip standard-version when running locally.
	// CI (release.yml) will run standard-version on tag push.
	await release({
		dryRun: isDryRun,
		verbose: true,
		bumpType,
		newVersion,
		skipStandardVersion: true,
	});
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});

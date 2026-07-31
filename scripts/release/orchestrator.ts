/**
 * Release orchestrator — picks the best adapter and runs the release.
 *
 * Architecture:
 * 1. Detect which stack(s) apply to the repo (detector)
 * 2. Select the best adapter (highest confidence, or compose multiple)
 * 3. Run standard-version to create the git tag
 * 4. Sync versions across all manifest files
 * 5. Amend commit, push, and publish
 *
 * The adapter handles all manifest-specific logic.
 * The orchestrator handles the git/npm plumbing.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "path";
import { detectStacks, formatProfile } from "./adapters/detector.ts";
import { nodeWorkspaceAdapter } from "./adapters/node-workspace.ts";
import { tauriAdapter } from "./adapters/tauri.ts";
import { rustAdapter } from "./adapters/rust.ts";
import { pythonAdapter } from "./adapters/python.ts";
import type { AdapterContext, ReleaseAdapter } from "./adapters/base.ts";

const ADAPTERS: ReleaseAdapter[] = [
	nodeWorkspaceAdapter,
	tauriAdapter,
	rustAdapter,
	pythonAdapter,
];

/** All adapters, sorted by confidence for this repo */
function rankedAdapters(ctx: AdapterContext): Array<{
	adapter: ReleaseAdapter;
	confidence: number;
}> {
	return ADAPTERS.map((a) => ({ adapter: a, confidence: a.detect(ctx) }))
		.filter((r) => r.confidence > 0)
		.sort((a, b) => b.confidence - a.confidence);
}

/** Run a git command, return trimmed stdout */
function git(args: string[], cwd: string): string {
	try {
		return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf-8" }).trim();
	} catch {
		return "";
	}
}

/** Run a git command, ignore errors */
function gitQuiet(args: string[], cwd: string): void {
	try {
		execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf-8" });
	} catch {
		// ignore
	}
}

export interface ReleaseOptions {
	repoRoot?: string;
	dryRun?: boolean;
	verbose?: boolean;
	bumpType?: "patch" | "minor" | "major" | "prerelease";
	newVersion?: string;
	skipGit?: boolean;
	skipNpm?: boolean;
	skipPublish?: boolean;
	/**
	 * Skip running standard-version (tag creation).
	 * Set to true when running locally - CI handles standard-version.
	 */
	skipStandardVersion?: boolean;
}

/**
 * Detect the best adapter for a repo without running any changes.
 */
export function detect(options: ReleaseOptions = {}): string {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const ctx: AdapterContext = {
		repoRoot,
		dryRun: options.dryRun ?? false,
		verbose: options.verbose ?? false,
	};

	const profile = detectStacks(ctx);
	return formatProfile(profile);
}

/**
 * Run the full release flow with the best adapter.
 */
export async function release(options: ReleaseOptions = {}): Promise<void> {
	const repoRoot = resolve(options.repoRoot ?? process.cwd());
	const dryRun = options.dryRun ?? false;
	const verbose = options.verbose ?? false;
	const ctx: AdapterContext = { repoRoot, dryRun, verbose };

	// ── Step 0: Detect stacks ───────────────────────────────────────────────
	const profile = detectStacks(ctx);
	if (verbose) {
		console.log(formatProfile(profile));
	}

	if (profile.unknown) {
		console.warn(
			"\n⚠️  No known stack detected. Run with --verbose to see detection results.",
		);
		console.warn("   Falling back to Node workspace adapter...\n");
	}

	// Pick the best adapter
	const ranked = rankedAdapters(ctx);
	const adapter = ranked[0]?.adapter ?? nodeWorkspaceAdapter;

	if (verbose) {
		console.log(`\n📦 Using adapter: ${adapter.name} (${adapter.id})`);
	}

	// ── Step 1: Run standard-version (only in CI, not locally) ───────────
	// Local runs: skip standard-version, just bump versions
	// CI runs: run standard-version to create tags
	if (options.skipStandardVersion) {
		console.log(`\n🚀 Release (${adapter.name})\n`);
		console.log(`📦 Step 1: Skipping standard-version (run locally)`);
		console.log(`   CI will run standard-version on tag push\n`);
	} else {
		const bumpArg = options.newVersion ?? options.bumpType ?? "patch";
		const stdCmd = dryRun
			? `npx standard-version --dry-run --release-as ${bumpArg}`
			: `npx standard-version --release-as ${bumpArg}`;

		console.log(`\n🚀 Release (${adapter.name})\n`);
		if (!options.skipGit) {
			console.log(`📦 Step 1: Running standard-version...`);
			console.log(`   $ ${stdCmd}`);
			if (!dryRun) {
				try {
					execSync(stdCmd, { cwd: repoRoot, stdio: "inherit" });
				} catch {
					console.error("standard-version failed.");
					process.exit(1);
				}
			}
		}
	}

	// ── Step 2: Read new version from git tag ─────────────────────────────
	let newVersion: string;
	if (!options.skipGit) {
		try {
			const tags = git(["tag", "--sort=-v:refname"], repoRoot);
			const latestTag = tags.split("\n")[0];
			newVersion = latestTag.startsWith("v") ? latestTag.slice(1) : latestTag;
		} catch {
			// Fallback: read from adapter
			newVersion = (await adapter.getCanonicalVersion(ctx)) ?? "0.0.0";
		}
	} else {
		newVersion = (await adapter.getCanonicalVersion(ctx)) ?? "0.0.0";
	}

	if (options.newVersion) {
		newVersion = options.newVersion;
	}

	console.log(`\n📋 Step 2: Release version is ${newVersion}`);

	// ── Step 3: Sync all manifest versions ────────────────────────────────
	const manifests = await adapter.readManifests(ctx);
	console.log(
		`\n📦 Step 3: Syncing ${manifests.length} manifest(s) to ${newVersion}...`,
	);
	if (verbose) {
		for (const m of manifests) {
			console.log(`   ${m.path}: ${m.version} -> ${newVersion}`);
		}
	}

	const bumpResult = await adapter.bump(
		ctx,
		options.bumpType ?? "patch",
		newVersion,
	);
	for (const action of bumpResult.actions) {
		console.log(`   ${action}`);
	}

	// ── Step 4: Verify ──────────────────────────────────────────────────
	console.log(`\n🔍 Step 4: Verifying...`);
	const verifyResult = await adapter.verify(ctx, newVersion);

	for (const warning of verifyResult.warnings) {
		console.warn(`   ⚠ ${warning}`);
	}
	for (const error of verifyResult.errors) {
		console.error(`   ✖ ${error}`);
	}

	if (!verifyResult.ok && !dryRun) {
		// In dry-run, versions aren't actually bumped yet, so mismatch is expected
		console.error(
			"\n✖ Verification failed. Fix the errors above before releasing.\n",
		);
		process.exit(1);
	}

	if (verifyResult.ok) {
		console.log(`   ✓ All manifests synchronized to ${newVersion}`);
	} else if (dryRun) {
		console.log(
			`   ⚠ Verification skipped in dry-run (versions not yet bumped)`,
		);
	}

	// ── Step 5: Git amend (include manifest changes in the tag commit) ───
	if (!options.skipGit && !dryRun) {
		console.log(`\n🔧 Step 5: Amending commit with manifest changes...`);
		gitQuiet(["add", "-A"], repoRoot);
		const status = git(["status", "--short"], repoRoot);
		if (status) {
			console.log(`   Staged:\n${status}`);
			try {
				gitQuiet(["commit", "--amend", "--no-edit"], repoRoot);
				console.log(`   ✓ Committed (amended)`);
			} catch {
				console.warn(`   ⚠ Could not amend commit`);
			}
		} else {
			console.log(`   No changes to commit`);
		}
	}

	// ── Step 6: Push ────────────────────────────────────────────────────
	if (!options.skipGit && !dryRun) {
		console.log(`\n🚀 Step 6: Pushing to origin...`);
		try {
			execSync("git push --follow-tags origin develop", {
				cwd: repoRoot,
				stdio: "inherit",
			});
		} catch {
			console.error("Git push failed.");
			process.exit(1);
		}
	}

	// ── Step 7: Publish to npm ────────────────────────────────────────────
	if (!options.skipNpm && !options.skipPublish && !dryRun) {
		const hasNpmPkg = existsSync(resolve(repoRoot, "package.json"));
		if (hasNpmPkg) {
			console.log(`\n📦 Step 7: Publishing to npm...`);
			try {
				execSync("npm publish --workspaces=false", {
					cwd: repoRoot,
					stdio: "inherit",
				});
			} catch {
				console.error(
					"npm publish failed. Check that you're logged in (npm login).",
				);
				process.exit(1);
			}
		}
	}

	console.log(`\n✅ Release ${newVersion} complete (${adapter.name})\n`);
}

/**
 * Node.js / npm Workspace adapter.
 *
 * Handles:
 * - root package.json
 * - workspace package.json files (packages/*)
 *
 * Source of truth: root package.json version
 */

import type {
	AdapterContext,
	BumpResult,
	ReleaseAdapter,
	VerificationResult,
	VersionManifest,
} from "./base.ts";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "path";

const ROOT_PKG = "package.json";
const WORKSPACE_GLOB = "packages/*";

function getWorkspaceDirs(repoRoot: string): string[] {
	const dirs: string[] = [];
	const globBase = resolve(repoRoot, WORKSPACE_GLOB.replace(/\/\*$/, ""));

	let entries: string[];
	try {
		entries = readdirSync(globBase);
	} catch {
		return dirs;
	}

	for (const entry of entries) {
		const pkgPath = join(globBase, entry, ROOT_PKG);
		if (existsSync(pkgPath)) {
			dirs.push(resolve(globBase, entry));
		}
	}
	return dirs;
}

async function readManifest(
	ctx: AdapterContext,
	relPath: string,
): Promise<VersionManifest | null> {
	const absPath = join(ctx.repoRoot, relPath);
	if (!existsSync(absPath)) return null;

	let raw: string;
	try {
		raw = await readFile(absPath, "utf-8");
	} catch {
		return null;
	}

	let pkg: Record<string, unknown>;
	try {
		pkg = JSON.parse(raw);
	} catch {
		return null;
	}

	const version = typeof pkg.version === "string" ? pkg.version : "";
	return { path: relPath, version, content: raw };
}

async function writeManifest(
	ctx: AdapterContext,
	manifest: VersionManifest,
	newVersion: string,
): Promise<void> {
	if (ctx.dryRun) return;

	const absPath = join(ctx.repoRoot, manifest.path);
	let pkg: Record<string, unknown>;
	try {
		pkg = JSON.parse(manifest.content);
	} catch {
		return;
	}

	pkg.version = newVersion;

	// Re-serialize: parse→stringify→parse→stringify collapses duplicate keys
	// (duplicate "version" keys are valid JSON but break bun install)
	let serialized: string;
	try {
		serialized = JSON.stringify(JSON.parse(JSON.stringify(pkg)), null, 2);
	} catch {
		serialized = JSON.stringify(pkg, null, 2);
	}
	await writeFile(absPath, `${serialized}\n`);
}

export const nodeWorkspaceAdapter: ReleaseAdapter = {
	id: "node-workspace",
	name: "Node.js / npm Workspace",

	detect(ctx: AdapterContext): number {
		const rootPkg = join(ctx.repoRoot, "package.json");
		if (!existsSync(rootPkg)) return 0;

		// Must have workspaces field
		try {
			const raw = JSON.parse(
				readFileSync(rootPkg, "utf-8") as unknown as string,
			);
			if (raw.workspaces) return 0.9;
		} catch {
			// ignore
		}

		// Plain Node repo (no workspaces) still qualifies
		return 0.6;
	},

	async readManifests(ctx: AdapterContext): Promise<VersionManifest[]> {
		const manifests: VersionManifest[] = [];

		// Root package.json
		const root = await readManifest(ctx, ROOT_PKG);
		if (root) manifests.push(root);

		// Workspace package.json files
		const dirs = getWorkspaceDirs(ctx.repoRoot);
		for (const dir of dirs) {
			const relPath = dir.replace(ctx.repoRoot + "/", "");
			const manifest = await readManifest(ctx, `${relPath}/${ROOT_PKG}`);
			if (manifest) manifests.push(manifest);
		}

		return manifests;
	},

	async bump(
		ctx: AdapterContext,
		bumpType,
		newVersion?: string,
	): Promise<BumpResult> {
		const manifests = await this.readManifests(ctx);
		const root = manifests.find((m) => m.path === ROOT_PKG);
		const rootVersion = root?.version ?? "0.0.0";

		// Determine new version
		let finalVersion: string;
		if (newVersion) {
			finalVersion = newVersion;
		} else {
			const parts = rootVersion.split("-")[0].split(".").map(Number);
			const [major = 0, minor = 0, patch = 0] = parts;
			switch (bumpType) {
				case "major":
					finalVersion = `${major + 1}.0.0`;
					break;
				case "minor":
					finalVersion = `${major}.${minor + 1}.0`;
					break;
				case "prerelease":
					finalVersion = `${rootVersion}`;
					break;
				default:
					// patch
					finalVersion = `${major}.${minor}.${patch + 1}`;
			}
		}

		const actions: string[] = [];
		const updated: VersionManifest[] = [];

		// Update all manifests
		for (const manifest of manifests) {
			if (ctx.verbose) {
				actions.push(
					`Update ${manifest.path}: ${manifest.version} -> ${finalVersion}`,
				);
			}
			await writeManifest(ctx, manifest, finalVersion);
			updated.push({ ...manifest, version: finalVersion });
		}

		return { newVersion: finalVersion, updated, actions };
	},

	async verify(
		ctx: AdapterContext,
		expectedVersion: string,
	): Promise<VerificationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];

		const manifests = await this.readManifests(ctx);
		if (manifests.length === 0) {
			errors.push("No package.json files found");
			return { ok: false, errors, warnings };
		}

		const versions = manifests.map((m) => m.version);
		const unique = [...new Set(versions)];

		if (unique.length > 1) {
			errors.push(
				`Version mismatch across packages: ${JSON.stringify(
					Object.fromEntries(manifests.map((m) => [m.path, m.version])),
				)}`,
			);
		}

		if (!expectedVersion && unique.length === 1) {
			// All good — all versions match
		} else if (
			expectedVersion &&
			unique.length === 1 &&
			unique[0] !== expectedVersion
		) {
			errors.push(
				`Version ${unique[0]} does not match expected ${expectedVersion}`,
			);
		}

		return { ok: errors.length === 0, errors, warnings };
	},

	async getCanonicalVersion(ctx: AdapterContext): Promise<string | null> {
		const root = await readManifest(ctx, ROOT_PKG);
		return root?.version ?? null;
	},
};

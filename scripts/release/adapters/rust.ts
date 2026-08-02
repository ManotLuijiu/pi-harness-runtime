/**
 * Rust adapter.
 *
 * Handles version synchronization for Rust crates:
 * - Cargo.toml (version field)
 *
 * Source of truth: Cargo.toml version field
 */

import type {
	AdapterContext,
	BumpResult,
	ReleaseAdapter,
	VerificationResult,
	VersionManifest,
} from "./base.ts";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "path";

export const rustAdapter: ReleaseAdapter = {
	id: "rust",
	name: "Rust Crate",

	detect(ctx: AdapterContext): number {
		const hasRootCargo = existsSync(join(ctx.repoRoot, "Cargo.toml"));
		const hasTauriCargo = existsSync(
			join(ctx.repoRoot, "src-tauri", "Cargo.toml"),
		);

		// Root Cargo.toml without Tauri structure
		if (hasRootCargo && !hasTauriCargo) return 0.95;
		return 0;
	},

	async readManifests(ctx: AdapterContext): Promise<VersionManifest[]> {
		const manifest: VersionManifest | null = await (async () => {
			const path = join(ctx.repoRoot, "Cargo.toml");
			if (!existsSync(path)) return null;
			try {
				const content = await readFile(path, "utf-8");
				const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
				if (!match) return null;
				return { path: "Cargo.toml", version: match[1], content };
			} catch {
				return null;
			}
		})();
		return manifest ? [manifest] : [];
	},

	async bump(
		ctx: AdapterContext,
		bumpType: "patch" | "minor" | "major" | "prerelease",
		newVersion?: string,
	): Promise<BumpResult> {
		const manifests = await this.readManifests(ctx);
		const base = manifests[0]?.version ?? "0.1.0";

		let finalVersion: string;
		if (newVersion) {
			finalVersion = newVersion;
		} else {
			const parts = base.split("-")[0].split(".").map(Number);
			const [major = 0, minor = 0, patch = 0] = parts;
			switch (bumpType) {
				case "major":
					finalVersion = `${major + 1}.0.0`;
					break;
				case "minor":
					finalVersion = `${major}.${minor + 1}.0`;
					break;
				case "prerelease":
					finalVersion = base;
					break;
				default:
					finalVersion = `${major}.${minor}.${patch + 1}`;
			}
		}

		const actions: string[] = [];
		const updated: VersionManifest[] = [];

		if (!ctx.dryRun && manifests.length > 0) {
			const absPath = join(ctx.repoRoot, "Cargo.toml");
			let content = manifests[0].content;
			content = content.replace(
				/^(\s*version\s*=\s*")([^"]+)(")/m,
				`$1${finalVersion}$3`,
			);
			await writeFile(absPath, content);
			actions.push(`Update Cargo.toml: ${base} -> ${finalVersion}`);
		} else {
			actions.push(
				`[dry-run] Would update Cargo.toml: ${base} -> ${finalVersion}`,
			);
		}

		updated.push({ path: "Cargo.toml", version: finalVersion, content: "" });
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
			errors.push("Cargo.toml not found or has no version field");
			return { ok: false, errors, warnings };
		}

		if (expectedVersion && manifests[0].version !== expectedVersion) {
			errors.push(
				`Cargo.toml version ${manifests[0].version} does not match expected ${expectedVersion}`,
			);
		}

		return { ok: errors.length === 0, errors, warnings };
	},

	async getCanonicalVersion(ctx: AdapterContext): Promise<string | null> {
		const manifests = await this.readManifests(ctx);
		return manifests[0]?.version ?? null;
	},
};

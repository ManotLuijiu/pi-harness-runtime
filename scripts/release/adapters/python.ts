/**
 * Python adapter.
 *
 * Handles version synchronization for Python packages:
 * - pyproject.toml (project.version field)
 *
 * Source of truth: pyproject.toml version field
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

function parsePyprojectVersion(content: string): string | null {
	// Try PEP 621 format: [project] ... version = "1.2.3"
	let match = content.match(/^\[project\][\s\S]*?^\s*version\s*=\s*"([^"]+)"/m);
	if (match) return match[1];

	// Try poetry format: [tool.poetry] ... version = "1.2.3"
	match = content.match(
		/^\[tool\.poetry\][\s\S]*?^\s*version\s*=\s*"([^"]+)"/m,
	);
	if (match) return match[1];

	// Try setup.cfg style: version = "1.2.3"
	match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
	if (match) return match[1];

	return null;
}

function bumpVersion(
	content: string,
	newVersion: string,
): { content: string; found: boolean } {
	// Try PEP 621 first
	let found = false;
	let result = content.replace(
		/^(\s*version\s*=\s*")([^"]+)(")/m,
		(_m, before: string, _old: string, after: string) => {
			found = true;
			return `${before}${newVersion}${after}`;
		},
	);
	if (found) return { content: result, found: true };

	// Try poetry format
	result = content.replace(
		/^(\s*version\s*=\s*")([^"]+)(")/m,
		(_m, before: string, _old: string, after: string) => {
			found = true;
			return `${before}${newVersion}${after}`;
		},
	);
	if (found) return { content: result, found: true };

	return { content, found: false };
}

export const pythonAdapter: ReleaseAdapter = {
	id: "python",
	name: "Python Package",

	detect(ctx: AdapterContext): number {
		const hasPyproject = existsSync(join(ctx.repoRoot, "pyproject.toml"));
		const hasSetupPy = existsSync(join(ctx.repoRoot, "setup.py"));
		const hasSetupCfg = existsSync(join(ctx.repoRoot, "setup.cfg"));

		if (hasPyproject) return 0.95;
		if (hasSetupPy || hasSetupCfg) return 0.85;
		return 0;
	},

	async readManifests(ctx: AdapterContext): Promise<VersionManifest[]> {
		const manifests: VersionManifest[] = [];

		// pyproject.toml
		const pyprojectPath = join(ctx.repoRoot, "pyproject.toml");
		if (existsSync(pyprojectPath)) {
			try {
				const content = await readFile(pyprojectPath, "utf-8");
				const version = parsePyprojectVersion(content);
				if (version) {
					manifests.push({
						path: "pyproject.toml",
						version,
						content,
					});
				}
			} catch {
				// ignore
			}
		}

		// setup.py (if it has a version= assignment)
		const setupPyPath = join(ctx.repoRoot, "setup.py");
		if (existsSync(setupPyPath)) {
			try {
				const content = await readFile(setupPyPath, "utf-8");
				const match = content.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
				if (match) {
					manifests.push({
						path: "setup.py",
						version: match[1],
						content,
					});
				}
			} catch {
				// ignore
			}
		}

		return manifests;
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

		// pyproject.toml
		const pyprojectPath = join(ctx.repoRoot, "pyproject.toml");
		if (existsSync(pyprojectPath)) {
			const absPath = join(ctx.repoRoot, "pyproject.toml");
			let content: string;
			try {
				content = await readFile(absPath, "utf-8");
			} catch {
				content = "";
			}

			const { content: newContent, found } = bumpVersion(content, finalVersion);
			if (found && !ctx.dryRun) {
				await writeFile(absPath, newContent);
			}
			actions.push(
				`${ctx.dryRun ? "[dry-run] " : ""}Update pyproject.toml: ${base} -> ${finalVersion}`,
			);
			updated.push({
				path: "pyproject.toml",
				version: finalVersion,
				content: newContent,
			});
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
			errors.push(
				"No Python version manifests found (pyproject.toml, setup.py)",
			);
			return { ok: false, errors, warnings };
		}

		const versions = manifests.map((m) => m.version);
		const unique = [...new Set(versions)];

		if (unique.length > 1) {
			errors.push(
				`Version mismatch across Python manifests: ${JSON.stringify(
					Object.fromEntries(manifests.map((m) => [m.path, m.version])),
				)}`,
			);
		}

		if (
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
		// pyproject.toml is canonical if present
		const pyprojectPath = join(ctx.repoRoot, "pyproject.toml");
		if (existsSync(pyprojectPath)) {
			try {
				const content = await readFile(pyprojectPath, "utf-8");
				return parsePyprojectVersion(content);
			} catch {
				return null;
			}
		}
		const manifests = await this.readManifests(ctx);
		return manifests[0]?.version ?? null;
	},
};

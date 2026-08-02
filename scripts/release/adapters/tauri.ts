/**
 * Tauri adapter.
 *
 * Handles version synchronization for Tauri desktop apps across:
 * - package.json (npm frontend version)
 * - src-tauri/Cargo.toml (Rust backend version)
 * - src-tauri/tauri.conf.json (Tauri app version)
 *
 * Source of truth: whichever file has the version that was bumped,
 * typically package.json. Other files are synchronized to match.
 *
 * Detection: repo has src-tauri/Cargo.toml AND src-tauri/tauri.conf.json
 */

import type {
	AdapterContext,
	BumpResult,
	ReleaseAdapter,
	VerificationResult,
	VersionManifest,
} from "./base.ts";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "path";

const MANIFESTS = [
	"package.json",
	"src-tauri/Cargo.toml",
	"src-tauri/tauri.conf.json",
] as const;

type TauriManifest = (typeof MANIFESTS)[number];

function parsePackageJson(content: string): string | null {
	try {
		const pkg = JSON.parse(content);
		return typeof pkg.version === "string" ? pkg.version : null;
	} catch {
		return null;
	}
}

function parseCargoToml(content: string): string | null {
	// Cargo.toml version: version = "1.2.3"
	const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
	return match ? match[1] : null;
}

function parseTauriConf(content: string): string | null {
	try {
		const conf = JSON.parse(content);
		return typeof conf.version === "string" ? conf.version : null;
	} catch {
		// Try toml format
		const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
		return match ? match[1] : null;
	}
}

function parseVersion(path: TauriManifest, content: string): string | null {
	switch (path) {
		case "package.json":
			return parsePackageJson(content);
		case "src-tauri/Cargo.toml":
			return parseCargoToml(content);
		case "src-tauri/tauri.conf.json":
			return parseTauriConf(content);
	}
}

async function writePackageJson(
	ctx: AdapterContext,
	relPath: string,
	version: string,
): Promise<void> {
	if (ctx.dryRun) return;
	const { readFile, writeFile } = await import("node:fs/promises");
	const absPath = join(ctx.repoRoot, relPath);
	let pkg: Record<string, unknown>;
	try {
		pkg = JSON.parse(await readFile(absPath, "utf-8"));
	} catch {
		return;
	}
	pkg.version = version;
	await writeFile(absPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function writeCargoToml(
	ctx: AdapterContext,
	relPath: string,
	version: string,
): Promise<void> {
	if (ctx.dryRun) return;
	const { readFile, writeFile } = await import("node:fs/promises");
	const absPath = join(ctx.repoRoot, relPath);
	let content: string;
	try {
		content = await readFile(absPath, "utf-8");
	} catch {
		return;
	}
	// Replace version = "x.y.z" with new version
	content = content.replace(
		/^(\s*version\s*=\s*")([^"]+)(")/m,
		`$1${version}$3`,
	);
	await writeFile(absPath, content);
}

async function writeTauriConf(
	ctx: AdapterContext,
	relPath: string,
	version: string,
): Promise<void> {
	if (ctx.dryRun) return;
	const { readFile, writeFile } = await import("node:fs/promises");
	const absPath = join(ctx.repoRoot, relPath);
	let content: string;
	try {
		content = await readFile(absPath, "utf-8");
	} catch {
		return;
	}

	// Try JSON first
	try {
		const conf = JSON.parse(content);
		conf.version = version;
		await writeFile(absPath, JSON.stringify(conf, null, 2) + "\n");
		return;
	} catch {
		// Not JSON, try TOML
	}

	// TOML format: version = "1.2.3"
	content = content.replace(
		/^(\s*version\s*=\s*")([^"]+)(")/m,
		`$1${version}$3`,
	);
	await writeFile(absPath, content);
}

async function writeManifest(
	ctx: AdapterContext,
	relPath: string,
	version: string,
): Promise<void> {
	if (relPath === "package.json") {
		await writePackageJson(ctx, relPath, version);
	} else if (relPath === "src-tauri/Cargo.toml") {
		await writeCargoToml(ctx, relPath, version);
	} else if (relPath === "src-tauri/tauri.conf.json") {
		await writeTauriConf(ctx, relPath, version);
	}
}

export const tauriAdapter: ReleaseAdapter = {
	id: "tauri",
	name: "Tauri Desktop App",

	detect(ctx: AdapterContext): number {
		const hasCargo = existsSync(join(ctx.repoRoot, "src-tauri", "Cargo.toml"));
		const hasTauriConf = existsSync(
			join(ctx.repoRoot, "src-tauri", "tauri.conf.json"),
		);
		const hasPackageJson = existsSync(join(ctx.repoRoot, "package.json"));

		if (hasCargo && hasTauriConf && hasPackageJson) return 0.95;
		if (hasCargo && hasTauriConf) return 0.9;
		return 0;
	},

	async readManifests(ctx: AdapterContext): Promise<VersionManifest[]> {
		const manifests: VersionManifest[] = [];
		for (const relPath of MANIFESTS) {
			const absPath = join(ctx.repoRoot, relPath);
			if (!existsSync(absPath)) continue;
			try {
				const content = await readFile(absPath, "utf-8");
				const version = parseVersion(relPath, content);
				if (version) {
					manifests.push({ path: relPath, version, content });
				}
			} catch {
				// ignore unreadable files
			}
		}
		return manifests;
	},

	async bump(
		ctx: AdapterContext,
		bumpType: "patch" | "minor" | "major" | "prerelease",
		newVersion?: string,
	): Promise<BumpResult> {
		// Determine canonical version
		let finalVersion: string;

		if (newVersion) {
			finalVersion = newVersion;
		} else {
			// Read all manifests to determine current base version
			const manifests = await this.readManifests(ctx);
			const versions = manifests.map((m) => m.version);
			const canonical = versions[0] ?? "0.0.0";

			const parts = canonical.split("-")[0].split(".").map(Number);
			const [major = 0, minor = 0, patch = 0] = parts;
			switch (bumpType) {
				case "major":
					finalVersion = `${major + 1}.0.0`;
					break;
				case "minor":
					finalVersion = `${major}.${minor + 1}.0`;
					break;
				case "prerelease":
					finalVersion = canonical;
					break;
				default:
					finalVersion = `${major}.${minor}.${patch + 1}`;
			}
		}

		const actions: string[] = [];
		const updated: VersionManifest[] = [];

		// Write to all three manifests
		for (const relPath of MANIFESTS) {
			const absPath = join(ctx.repoRoot, relPath);
			if (!existsSync(absPath)) continue;

			if (ctx.verbose || ctx.dryRun) {
				actions.push(
					`Update ${relPath}: ${parseVersion(relPath, await readFile(absPath, "utf-8").catch(() => "")) ?? "?"} -> ${finalVersion}`,
				);
			}

			await writeManifest(ctx, relPath, finalVersion);
			updated.push({ path: relPath, version: finalVersion, content: "" });
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
		const missing = MANIFESTS.filter(
			(p) => !manifests.find((m) => m.path === p),
		);
		if (missing.length > 0) {
			warnings.push(
				`Missing manifest files (may be intentional): ${missing.join(", ")}`,
			);
		}

		const versions = manifests.map((m) => m.version);
		const unique = [...new Set(versions)];

		if (unique.length > 1) {
			errors.push(
				`Version mismatch across Tauri manifests: ${JSON.stringify(
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
		// package.json is the canonical source for Tauri apps (npm frontend)
		const root = join(ctx.repoRoot, "package.json");
		if (!existsSync(root)) return null;
		try {
			const content = await readFile(root, "utf-8");
			return parsePackageJson(content);
		} catch {
			return null;
		}
	},
};

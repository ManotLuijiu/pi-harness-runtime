/**
 * Repo detector — identifies which release adapter(s) apply to a repo.
 *
 * Detection is based on file presence, not heuristics about content.
 * Each adapter returns a confidence score 0-1.
 * The orchestrator picks the adapter with the highest score.
 */

import type { AdapterContext } from "./base.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "path";

/** A detected stack with its confidence score */
export interface StackDetection {
	id: string;
	name: string;
	confidence: number;
	hints: string[];
}

/** All detected stacks for a repo */
export interface RepoProfile {
	repoRoot: string;
	stacks: StackDetection[];
	unknown: boolean;
}

export interface DetectionHints {
	hasPackageJson: boolean;
	hasWorkspaces: boolean;
	hasNodeModules: boolean;
	hasCargoToml: boolean;
	hasTauriCargoToml: boolean;
	hasTauriManifest: boolean;
	hasPyprojectToml: boolean;
	hasSetupPy: boolean;
	hasCargoLock: boolean;
	hasPackageLockJson: boolean;
	hasYarnLock: boolean;
	hasPnpmLockYaml: boolean;
	hasBunLock: boolean;
}

function hasWorkspacesField(repoRoot: string): boolean {
	try {
		const pkgPath = join(repoRoot, "package.json");
		if (!existsSync(pkgPath)) return false;
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		return !!pkg.workspaces;
	} catch {
		return false;
	}
}

function gatherHints(ctx: AdapterContext): DetectionHints {
	const root = ctx.repoRoot;
	return {
		hasPackageJson: existsSync(join(root, "package.json")),
		hasWorkspaces: hasWorkspacesField(root),
		hasNodeModules: existsSync(join(root, "node_modules")),
		hasCargoToml: existsSync(join(root, "Cargo.toml")),
		hasTauriCargoToml: existsSync(join(root, "src-tauri", "Cargo.toml")),
		hasTauriManifest:
			existsSync(join(root, "src-tauri", "tauri.conf.json")) ||
			existsSync(join(root, "src-tauri", "Cargo.toml")),
		hasPyprojectToml: existsSync(join(root, "pyproject.toml")),
		hasSetupPy: existsSync(join(root, "setup.py")),
		hasCargoLock: existsSync(join(root, "Cargo.lock")),
		hasPackageLockJson: existsSync(join(root, "package-lock.json")),
		hasYarnLock: existsSync(join(root, "yarn.lock")),
		hasPnpmLockYaml: existsSync(join(root, "pnpm-lock.yaml")),
		hasBunLock: existsSync(join(root, "bun.lock")),
	};
}

/**
 * Detect all applicable stacks for a repo.
 *
 * Confidence:
 * - 0.95: definitive (correlating files present)
 * - 0.85: strong (primary file + ecosystem indicator)
 * - 0.7: moderate (primary file only)
 * - 0.0: not detected
 */
export function detectStacks(ctx: AdapterContext): RepoProfile {
	const hints = gatherHints(ctx);
	const stacks: StackDetection[] = [];

	// Tauri Desktop App
	if (
		hints.hasTauriManifest &&
		(hints.hasCargoToml || hints.hasTauriCargoToml)
	) {
		stacks.push({
			id: "tauri",
			name: "Tauri Desktop App",
			confidence: 0.95,
			hints: ["src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"],
		});
	}

	// Node.js / npm Workspace (monorepo)
	// Strong: package.json + workspaces field + lock file
	if (hints.hasPackageJson && hints.hasWorkspaces) {
		const hasLock =
			hints.hasPackageLockJson ||
			hints.hasYarnLock ||
			hints.hasPnpmLockYaml ||
			hints.hasBunLock;
		stacks.push({
			id: "node-workspace",
			name: "Node.js / npm",
			confidence: hasLock ? 0.95 : 0.85,
			hints: ["package.json", "workspaces"],
		});
	}

	// Plain Node.js repo (no workspaces)
	if (hints.hasPackageJson && !hints.hasWorkspaces) {
		stacks.push({
			id: "node-workspace",
			name: "Node.js / npm",
			confidence: 0.7,
			hints: ["package.json"],
		});
	}

	// Rust crate (root Cargo.toml, no Tauri)
	if (hints.hasCargoToml && !hints.hasTauriManifest) {
		stacks.push({
			id: "rust",
			name: "Rust Crate",
			confidence: 0.95,
			hints: ["Cargo.toml"],
		});
	}

	// Python package
	if (hints.hasPyprojectToml) {
		stacks.push({
			id: "python",
			name: "Python Package",
			confidence: 0.95,
			hints: ["pyproject.toml"],
		});
	} else if (hints.hasSetupPy) {
		stacks.push({
			id: "python",
			name: "Python Package",
			confidence: 0.85,
			hints: ["setup.py"],
		});
	}

	stacks.sort((a, b) => b.confidence - a.confidence);
	return { repoRoot: ctx.repoRoot, stacks, unknown: stacks.length === 0 };
}

/** Get the best adapter ID, or null if unknown */
export function bestAdapter(ctx: AdapterContext): string | null {
	const profile = detectStacks(ctx);
	return profile.stacks[0]?.id ?? null;
}

/** Human-readable profile for verbose/dry-run output */
export function formatProfile(profile: RepoProfile): string {
	const lines: string[] = [`Repo: ${profile.repoRoot}`];

	if (profile.unknown) {
		lines.push("  No known stack detected — release adapters may not apply.");
		return lines.join("\n");
	}

	lines.push("  Detected stacks:");
	for (const stack of profile.stacks) {
		const pct = Math.round(stack.confidence * 100);
		lines.push(`    ${pct}%  ${stack.name} (${stack.id})`);
		lines.push(`         hints: ${stack.hints.join(", ")}`);
	}
	return lines.join("\n");
}

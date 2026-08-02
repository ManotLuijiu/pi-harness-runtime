#!/usr/bin/env bun
/**
 * Check that all version files match the latest git tag.
 * Usage: bun scripts/check-version-sync.ts
 *
 * Exits 0 if all versions match, exits 1 if mismatch.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "path";

const repoRoot = resolve(import.meta.dir, "..");

function git(args: string[]): string {
	try {
		return execSync(`git ${args.join(" ")}`, {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (e) {
		const err = e as { status?: number };
		if (err.status === 128) return ""; // no tags
		throw e;
	}
}

interface PackageJson {
	version: string;
	workspaces?: string[];
}

function readJson(path: string): PackageJson | null {
	try {
		return JSON.parse(readFileSync(resolve(repoRoot, path), "utf-8"));
	} catch {
		return null;
	}
}

// Get latest git tag
const tags = git(["tag", "--sort=-v:refname"]);
const latestTag = tags.split("\n")[0] || "";
const latestVersion = latestTag.startsWith("v")
	? latestTag.slice(1)
	: latestTag;

console.log(`Git tag (latest): ${latestVersion}`);

// Check root package.json
const rootPkg = readJson("package.json");
if (!rootPkg) {
	console.error("Cannot read package.json");
	process.exit(1);
}
console.log(`package.json     : ${rootPkg.version}`);

// Check all workspace packages
let hasMismatch = rootPkg.version !== latestVersion;

const workspaces = rootPkg.workspaces ?? [];
for (const ws of workspaces) {
	const pkgPath = ws.replace(/\/\*$/, "/package.json");
	const pkg = readJson(pkgPath);
	if (pkg && pkg.version !== latestVersion) {
		console.log(`${pkgPath} : ${pkg.version} ❌`);
		hasMismatch = true;
	}
}

// Result
if (hasMismatch) {
	console.log("\n❌ Version files do not match latest git tag.");
	console.log(`\nTo fix: bun run release:patch\n`);
	process.exit(1);
} else {
	console.log("\n✅ All versions match git tag");
	process.exit(0);
}

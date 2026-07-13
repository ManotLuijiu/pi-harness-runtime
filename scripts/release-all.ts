#!/usr/bin/env bun
/**
 * Release all workspace packages at the same version.
 *
 * 1. Runs standard-version to bump root version
 * 2. Reads the new version from root package.json
 * 3. Updates all workspace package.json files to the same version
 * 4. Amends the existing commit to include workspace changes
 *
 * Usage:
 *   bun scripts/release-all.ts              # bump patch
 *   bun scripts/release-all.ts --release-as minor
 *   bun scripts/release-all.ts --release-as 0.9.0
 *   bun scripts/release-all.ts --dry-run
 */

import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";
import { resolve, join } from "path";
import { existsSync, readdirSync } from "fs";

const ROOT = resolve(import.meta.dirname, "..");

function getWorkspaceDirs(): string[] {
	let workspacesRaw: string;
	try {
		workspacesRaw = execSync(
			`node -e "console.log(JSON.stringify(require('./package.json').workspaces))"`,
			{ cwd: ROOT, encoding: "utf-8" },
		);
	} catch {
		return [];
	}
	let workspaceGlobs: string[];
	try {
		workspaceGlobs = JSON.parse(workspacesRaw);
	} catch {
		return [];
	}
	const dirs: string[] = [];
	for (const glob of workspaceGlobs.flat()) {
		if (!glob.endsWith("/*")) continue;
		const base = resolve(ROOT, glob.replace(/\/\*$/, ""));
		let entries: string[];
		try {
			entries = readdirSync(base);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const pkgPath = join(base, entry, "package.json");
			if (existsSync(pkgPath)) {
				dirs.push(resolve(base, entry));
			}
		}
	}
	return dirs;
}

async function getRootVersion(): Promise<string> {
	let version: string;
	try {
		const raw = await readFile(join(ROOT, "package.json"), "utf-8");
		version = JSON.parse(raw).version;
	} catch {
		throw new Error("Cannot read root package.json");
	}
	if (!version) throw new Error("Root package.json has no version field");
	return version;
}

async function setWorkspaceVersion(
	workspacePath: string,
	version: string,
): Promise<void> {
	const pkgPath = join(workspacePath, "package.json");
	if (!existsSync(pkgPath)) return;
	let pkg: Record<string, unknown>;
	try {
		const raw = await readFile(pkgPath, "utf-8");
		pkg = JSON.parse(raw);
	} catch (err) {
		console.warn(`  Cannot update ${pkgPath}: ${String(err)}`);
		return;
	}
	pkg.version = version;
	// Re-serialize via JSON.parse→stringify to collapse any duplicate keys
	// (duplicate "version" keys are valid JSON but cause bun install to warn/fail)
	await writeFile(pkgPath, `${JSON.stringify(JSON.parse(JSON.stringify(pkg)), null, 2)}\n`);
	const name =
		typeof pkg.name === "string"
			? `${pkg.name}@${version}`
			: workspacePath.replace(`${ROOT}/`, "");
	console.log(`  Updated ${name}`);
}

function gitAmendCommit(): void {
	try {
		execSync("git add packages/*/package.json", { cwd: ROOT });
	} catch (err) {
		console.warn("   Could not stage workspace changes:", String(err));
		return;
	}
	let status: string;
	try {
		status = execSync("git status --short", {
			cwd: ROOT,
			encoding: "utf-8",
		}).trim();
	} catch {
		return;
	}
	if (!status) {
		console.log("   No workspace changes to commit.");
		return;
	}
	console.log(`   Staged:\n${status}`);
	try {
		execSync("git commit --amend --no-edit", { cwd: ROOT });
		console.log("   Committed (amended).");
	} catch (err) {
		console.warn("   Could not amend commit:", String(err));
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const isDryRun = args.includes("--dry-run");
	const releaseArgs = args.filter((a) => a !== "--dry-run");
	const cmdParts = releaseArgs.filter((a) => !a.startsWith("--dry-run"));
	const stdCmd =
		cmdParts.length > 0
			? `npx standard-version ${cmdParts.join(" ")}`
			: "npx standard-version";
	const cmd = isDryRun ? `${stdCmd} --dry-run` : stdCmd;

	console.log("\n🚀 Synced monorepo release\n");

	// Step 1: Run standard-version
	console.log("📦 Step 1: Running standard-version...");
	console.log(`   $ ${cmd}`);
	if (!isDryRun) {
		try {
			execSync(cmd, { cwd: ROOT, stdio: "inherit" });
		} catch {
			console.error("standard-version failed.");
			process.exit(1);
		}
	}

	// Step 2: Get new version
	const newVersion = await getRootVersion();
	console.log(`\n📋 Step 2: Root version is ${newVersion}`);

	// Step 3: Sync workspaces
	const workspaces = getWorkspaceDirs();
	console.log(
		`\n📦 Step 3: Syncing ${workspaces.length} workspace packages to ${newVersion}...`,
	);
	if (!isDryRun) {
		await Promise.all(
			workspaces.map((ws) => setWorkspaceVersion(ws, newVersion)),
		);
	} else {
		for (const ws of workspaces) {
			const name = ws.replace(`${ROOT}/`, "");
			console.log(`  [dry-run] Would sync ${name} → ${newVersion}`);
		}
	}

	// Step 4: Amend commit to include workspace changes
	if (!isDryRun) {
		console.log("\n🔧 Step 4: Amending commit with workspace changes...");
		gitAmendCommit();
	}

	console.log(`\n✅ Release ${newVersion} ready.\n`);
	console.log("   To publish:\n");
	console.log("   git push --follow-tags origin develop\n");
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});

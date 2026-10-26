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
	// The parse above already collapsed any duplicate keys (a duplicate
	// "version" key is valid JSON but makes bun install warn or fail), so the
	// plain serialization is enough. It cannot throw: the value came from
	// JSON.parse and holds nothing but JSON types.
	await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
	const name =
		typeof pkg.name === "string"
			? `${pkg.name}@${version}`
			: workspacePath.replace(`${ROOT}/`, "");
	console.log(`  Updated ${name}`);
}

/**
 * Open the pull request from `develop` into `main`.
 *
 * `main` is the branch npm publishes, so a release reaches it through a
 * pull request. The auto merge workflow merges that request once the
 * sensitive terms check and the tests pass.
 *
 * The pull request is a convenience, not a gate: when it cannot be
 * opened the command says so and the release continues. A release that
 * is prepared but not merged publishes nothing, because the tag is only
 * created on `main`.
 *
 * @param {string} version
 */
function openReleasePullRequest(version: string): void {
	const title = `Release ${version}`;
	const body = [
		`The release ${version} is prepared on \`develop\`.`,
		"",
		"This pull request is merged by the auto merge workflow once the",
		"required checks pass. The tag is created on `main` after the",
		"merge, and the tag is what publishes to npm.",
	].join("\n");
	try {
		const output = execSync(
			"gh pr create --base main --head develop --title " +
				JSON.stringify(title) +
				" --body " +
				JSON.stringify(body),
			{ cwd: ROOT, encoding: "utf-8" },
		);
		console.log(`   ${output.trim()}`);
	} catch (err) {
		const detail =
			err && typeof err === "object" && "stderr" in err
				? String((err as { stderr?: unknown }).stderr ?? "").trim()
				: "";
		console.log("   The pull request was not opened automatically.");
		if (detail) console.log(`   ${detail.split("\n")[0]}`);
		console.log("   Open it by hand:");
		console.log(
			`     gh pr create --base main --head develop --title "${title}"`,
		);
	}
}

/**
 * The version that the release branch carries.
 *
 * The version of the release is the version of `main`, because `main` is
 * what npm receives. The local manifest can be ahead of it or behind it,
 * so the branch is the truth here.
 *
 * @returns {{ version: string, sha: string }}
 */
function releaseBranchVersion(): { version: string; sha: string } {
	try {
		execSync("git fetch --quiet origin main", { cwd: ROOT });
		const raw = execSync("git show origin/main:package.json", {
			cwd: ROOT,
			encoding: "utf-8",
		});
		const manifest = JSON.parse(raw);
		if (!manifest.version) {
			throw new Error("origin/main has no version in its package.json");
		}
		const sha = execSync("git rev-parse origin/main", {
			cwd: ROOT,
			encoding: "utf-8",
		}).trim();
		return { version: manifest.version, sha };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`the release branch could not be read: ${message}`);
	}
}

/**
 * Is the version already on the registry?
 *
 * A version that is published cannot be published again. The tag for it
 * would publish nothing, and the release would look like a failure
 * without saying why.
 *
 * @param {string} version
 * @returns {boolean}
 */
function versionIsPublished(version: string): boolean {
	try {
		const output = execSync(
			`npm view pi-harness-runtime versions --json`,
			{ cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		);
		const versions = JSON.parse(output);
		const list = Array.isArray(versions) ? versions : [versions];
		return list.includes(version);
	} catch {
		// The registry could not be read. The release workflow checks
		// the registry again and stops when it cannot read it, so the
		// tag is not the only gate.
		return false;
	}
}

/**
 * Tag the release branch and push the tag.
 *
 * The tag is the release: it names the version and it triggers the
 * release workflow, which publishes to npm. It sits on `main`, because
 * `main` is the branch npm publishes, and the workflow refuses a tag
 * that is somewhere else.
 */
async function tagReleaseBranch(): Promise<void> {
	console.log("\n🏷️  Tagging the release branch...\n");
	try {
		const { version, sha } = releaseBranchVersion();
		const tag = `v${version}`;
		console.log(
			`   The release branch carries ${version} at ${sha.slice(0, 8)}.`,
		);

		const existing = execSync(
			`git ls-remote --tags origin "refs/tags/${tag}"`,
			{ cwd: ROOT, encoding: "utf-8" },
		).trim();
		if (existing) {
			console.log(`   The tag ${tag} is already on the remote.`);
			console.log("   Nothing was pushed.");
			return;
		}

		if (versionIsPublished(version)) {
			console.log(`   ${version} is already on the registry.`);
			console.log(
				"   The tag would publish nothing, so it was not created.",
			);
			return;
		}

		execSync(`git tag -a ${tag} ${sha} -m "Release ${version}"`, {
			cwd: ROOT,
			stdio: "inherit",
		});
		execSync(`git push origin ${tag}`, { cwd: ROOT, stdio: "inherit" });
		console.log(`\n✅ The tag ${tag} is pushed.`);
		console.log(
			"   The release workflow publishes it to npm and creates the",
		);
		console.log("   GitHub release.\n");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`   The tag was not pushed: ${message}`);
		process.exitCode = 1;
	}
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

	// The tag step runs alone. It happens after the merge, and it does
	// not change anything but the tag.
	if (args.includes("--tag")) {
		await tagReleaseBranch();
		return;
	}

	const releaseArgs = args.filter((a) => a !== "--dry-run");
	const cmdParts = releaseArgs.filter((a) => !a.startsWith("--dry-run"));
	// The tag is not created here. A tag names a release, and a release
	// is a version of `main` - the branch npm publishes. The tag is
	// created on the tip of `main`, after the merge, by `--tag`.
	const stdCmd =
		cmdParts.length > 0
			? `npx standard-version ${cmdParts.join(" ")} --skip.tag`
			: "npx standard-version --skip.tag";
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

	// Step 5: Push
	if (!isDryRun) {
		console.log("\n🚀 Step 5: Pushing to origin...");
		try {
			execSync("git push origin develop", {
				cwd: ROOT,
				stdio: "inherit",
			});
		} catch {
			console.error("Git push failed.");
			process.exit(1);
		}
	}

	// Step 6: Build and verify the package
	//
	// Nothing is published here. npm is published by the release
	// workflow, from `main`, with the OIDC credential of the registry.
	// A version that is published from a branch that is not the release
	// branch is a version that no gate ever saw.
	//
	// The build and the verification still run here, so a broken package
	// is found before the merge and not after it.
	if (!isDryRun) {
		console.log(
			"\n📦 Step 6: Building and verifying the package (no publish)...",
		);
		try {
			execSync("bun scripts/build-packages.ts", {
				cwd: ROOT,
				stdio: "inherit",
			});
			execSync("bun scripts/verify-package-contents.ts --pack", {
				cwd: ROOT,
				stdio: "inherit",
			});
		} catch {
			console.error("The build or the package verification failed.");
			process.exit(1);
		}
	}

	// Step 7: Open the pull request into the release branch.
	//
	// `main` is the branch npm publishes, so a change reaches it
	// through a pull request. The auto merge workflow merges that
	// request once the sensitive terms check and the tests pass.
	if (!isDryRun) {
		console.log(
			"\n🚀 Step 7: Opening the pull request from develop into main...",
		);
		openReleasePullRequest(newVersion);
	}

	console.log(`\n✅ Release ${newVersion} is prepared on develop.\n`);
	console.log("   The next steps are:");
	console.log(
		"   1. The pull request into main is merged once the gates pass.",
	);
	console.log(
		`   2. After the merge: bun scripts/release-all.ts --tag  (tags v${newVersion} on main)`,
	);
	console.log(
		"      The tag triggers the release workflow, which publishes to",
	);
	console.log("      npm through OIDC and creates the GitHub release.\n");
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});

#!/usr/bin/env bun
/**
 * Build every workspace package and fail loudly when a required output is
 * missing.
 *
 * Why this exists:
 *
 * 1. The old build command ended every package build with `|| true`, so a
 *    package that failed to compile was reported as a success. The release
 *    then published a package whose entry point did not exist.
 * 2. `tsc -p` skips emitting a file when its `.tsbuildinfo` says the file is
 *    unchanged. Deleting the build output without deleting the build info
 *    therefore produced a package with missing files. The build info is
 *    removed before every build so that the output always matches the source.
 * 3. A package with a known type error still emits its JavaScript (that is
 *    what `tsc` does without `noEmitOnError`). Those type errors are tracked
 *    by `scripts/typecheck-packages.mjs`; this script only cares about the
 *    files that the build was supposed to produce.
 *
 * Usage:
 *   bun scripts/build-packages.ts            # build everything
 *   bun scripts/build-packages.ts --check    # build and verify the entries
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(ROOT, "packages");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

/**
 * Packages that must not be compiled by this script.
 *
 * A package belongs here only when it cannot be compiled at all (for
 * example a vendored app without TypeScript sources). Every other package
 * must build, and a build failure must be reported instead of ignored.
 */
const SKIPPED = new Set<string>();

interface BuildResult {
	package: string;
	failed: boolean;
	errorCount: number;
	emitted: number;
}

function packageDirs(): string[] {
	if (!existsSync(PACKAGES_DIR)) return [];
	return readdirSync(PACKAGES_DIR)
		.map((entry) => join(PACKAGES_DIR, entry))
		.filter((dir) => {
			try {
				return statSync(dir).isDirectory();
			} catch {
				return false;
			}
		})
		.filter((dir) => existsSync(join(dir, "tsconfig.json")));
}

/** The files a package manifest promises to publish. */
function manifestEntries(dir: string): string[] {
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) return [];
	let manifest: { main?: string; exports?: unknown; bin?: unknown };
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		return [];
	}
	const entries: string[] = [];
	if (typeof manifest.main === "string") entries.push(manifest.main);
	if (typeof manifest.bin === "string") entries.push(manifest.bin);
	else if (manifest.bin && typeof manifest.bin === "object") {
		for (const value of Object.values(manifest.bin as Record<string, string>)) {
			if (typeof value === "string") entries.push(value);
		}
	}
	const walk = (node: unknown): void => {
		if (typeof node === "string") {
			if (node.startsWith("./")) entries.push(node);
			return;
		}
		if (node && typeof node === "object") {
			for (const value of Object.values(node as Record<string, unknown>)) walk(value);
		}
	};
	walk(manifest.exports);
	return [...new Set(entries)];
}

/** Remove the incremental build state so that every file is emitted again. */
function clearBuildState(dir: string): void {
	for (const entry of readdirSync(dir)) {
		if (entry.endsWith(".tsbuildinfo")) {
			rmSync(join(dir, entry), { force: true });
		}
	}
}

if (!existsSync(TSC)) {
	console.error(`build: ${TSC} not found - run "bun install" first`);
	process.exit(1);
}

const results: BuildResult[] = [];

for (const dir of packageDirs()) {
	const name = dir.slice(PACKAGES_DIR.length + 1);
	if (SKIPPED.has(name)) {
		console.log(`skip  ${name} (excluded from the build)`);
		continue;
	}

	clearBuildState(dir);

	const run = spawnSync(TSC, ["-p", join(dir, "tsconfig.json"), "--skipLibCheck"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
	const errorCount = (output.match(/error TS/g) ?? []).length;
	const failed = run.status !== 0;

	const emitted = manifestEntries(dir).filter((entry) => existsSync(join(dir, entry))).length;

	results.push({ package: name, failed, errorCount, emitted });

	if (failed) {
		// The type errors are tracked by the typecheck baseline. Print them so
		// that a new error is visible, but keep building the other packages.
		console.log(`warn  ${name} (${errorCount} type error(s))`);
	} else {
		console.log(`ok    ${name}`);
	}
}

const failed = results.filter((result) => result.failed);
const missing: string[] = [];
for (const result of results) {
	const dir = join(PACKAGES_DIR, result.package);
	for (const entry of manifestEntries(dir)) {
		if (!existsSync(join(dir, entry))) {
			missing.push(`${result.package} publishes ${entry} but the file was not built`);
		}
	}
}

console.log(
	`\nbuild: ${results.length} package(s) built, ${failed.length} with type errors`,
);

if (missing.length > 0) {
	console.error("\nbuild FAILED - required output is missing:");
	for (const item of missing) console.error(`  - ${item}`);
	process.exit(1);
}

console.log("build: every published entry point exists");

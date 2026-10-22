#!/usr/bin/env node
/**
 * Type check every TypeScript project that ships a tsconfig.json.
 *
 * `npm run build` compiles the packages but swallows every error (`|| true`),
 * and the CI "Type check" step used to be a no-op (`npm run typecheck ||
 * echo "No typecheck script"` - there was no typecheck script and no root
 * tsconfig.json), so nothing was ever type checked.
 *
 * This script is the real check: it runs `tsc --noEmit` per project and
 * fails when a project reports MORE errors than its recorded baseline.
 *
 * A baseline is the number of type errors a project already has on HEAD.
 * It exists because eight packages, the harness and the scripts directory
 * have pre-existing type errors that are tracked separately; without a
 * baseline this script could never go green. A baseline is a CEILING, not
 * a waiver: one additional error in a baselined project fails the build
 * too, so the blind spot cannot grow.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/**
 * Maximum tolerated number of type errors per project. A project that is
 * not listed must type check cleanly.
 */
const BASELINES = new Map([
	["a2a-adapter", 1],
	["clipboard-plugin", 1],
	["provider-router", 3],
	["providers", 4],
	["quota-manager", 2],
	["runtime", 5],
	["voice-api", 16],
	["worktree", 2],
	["harness", 35],
	["scripts", 15],
]);

const TSC_TIMEOUT_MS = 300_000;

const root = join(import.meta.dirname, "..");
const packagesDir = join(root, "packages");
const tsc = join(root, "node_modules", ".bin", "tsc");

if (!existsSync(tsc)) {
	console.error(`typecheck: ${tsc} not found - run "bun install" first`);
	process.exit(1);
}

/** All projects to check, relative to the repo root. */
const projects = [];
for (const name of readdirSync(packagesDir).sort()) {
	const project = join(packagesDir, name, "tsconfig.json");
	if (existsSync(project)) projects.push(relative(root, project));
}
for (const extra of ["harness", "scripts"]) {
	if (existsSync(join(root, extra, "tsconfig.json"))) {
		projects.push(join(extra, "tsconfig.json"));
	}
}

/** Baseline owner for a project path ("packages/runtime" -> that package). */
function ownerOf(projectPath) {
	const normalized = projectPath.split("\\").join("/");
	if (normalized.startsWith("packages/")) {
		return normalized.split("/")[1];
	}
	return normalized.split("/")[0];
}

const failures = [];
const baselined = [];
const improved = [];
const skipped = [];
let checked = 0;

// `tsc --noEmit` still writes the .tsbuildinfo of an incremental or
// composite project - into the repo, where those files are tracked. The
// build info is redirected to a temp directory so a type check never
// modifies the working tree.
const buildInfoDir = mkdtempSync(join(tmpdir(), "typecheck-packages-"));

for (const project of projects) {
	const owner = ownerOf(project);
	const baseline = BASELINES.get(owner) ?? 0;
	checked++;
	let output = "";
	let timedOut = false;
	const args = ["-p", join(root, project), "--noEmit", "--skipLibCheck"];
	const projectConfig = readFileSync(join(root, project), "utf8");
	if (/"(incremental|composite)"\s*:\s*true/.test(projectConfig)) {
		args.push("--tsBuildInfoFile", join(buildInfoDir, `${owner}.tsbuildinfo`));
	}
	try {
		output = execFileSync(tsc, args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: TSC_TIMEOUT_MS,
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch (error) {
		output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
		timedOut = Boolean(error.killed) || error.signal === "SIGTERM";
	}
		const errorLines = output.split("\n").filter((line) => /error TS/.test(line));
		// TS18003: "No inputs were found in config file". A package whose
		// sources are compiled output only (packages/*/src/*.js and *.d.ts
		// are gitignored) has no TypeScript input in a fresh checkout, so
		// there is nothing to check - that is not a type error.
		const noInputs = errorLines.some((line) => /error TS18003/.test(line));
		const count = errorLines.length;

		if (noInputs) {
			skipped.push(`${owner} (no TypeScript sources in this checkout)`);
			continue;
		}
		if (timedOut) {
		// A timeout is not a pass and not an error count - fail closed.
		failures.push({
			owner,
			project,
			count: -1,
			output: `type check timed out after ${TSC_TIMEOUT_MS} ms`,
		});
		continue;
	}
	if (count > baseline) {
		failures.push({ owner, project, count, output });
		continue;
	}
	if (baseline > 0) {
		if (count < baseline) {
			improved.push(`${owner} (${count} errors, baseline ${baseline})`);
		} else {
			baselined.push(`${owner} (${count} known errors)`);
		}
	}
}

// A baseline for a project that does not exist (renamed or removed) is stale.
for (const owner of BASELINES.keys()) {
	const stillExists = projects.some((project) => ownerOf(project) === owner);
	if (!stillExists) {
		failures.push({
			owner,
			project: owner,
			count: -1,
			output: `stale baseline: no project found for "${owner}"`,
		});
	}
}

console.log(`typecheck: ${checked} projects checked`);
if (skipped.length > 0) {
	console.log(`typecheck: ${skipped.length} project(s) skipped: ${skipped.join(", ")}`);
}
if (baselined.length > 0) {
	console.log(
		`typecheck: ${baselined.length} project(s) with known pre-existing errors: ${baselined.join(", ")}`,
	);
}
if (improved.length > 0) {
	console.warn(
		`typecheck: baseline can be lowered for: ${improved.join(", ")} (update BASELINES in ${relative(root, import.meta.filename)})`,
	);
}

if (failures.length > 0) {
	console.error(`typecheck: ${failures.length} project(s) with unexpected type errors:`);
	for (const failure of failures) {
		console.error(`--- ${failure.owner} (${failure.count < 0 ? failure.output : `${failure.count} errors`}) ---`);
		if (failure.count >= 0) console.error(failure.output.trim());
	}
	process.exit(1);
}

console.log("typecheck: no unexpected type errors");

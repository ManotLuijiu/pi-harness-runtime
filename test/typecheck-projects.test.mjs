/**
 * The TypeScript projects of the repository must be found by every tool
 * that reads them - the compiler in the type check, and the language
 * server in the editor.
 *
 * The scripts of the repository used to have their project in a config
 * with a name of its own at the root of the repository
 * (`tsconfig.scripts.json`). A language server looks for the nearest
 * `tsconfig.json`, so it found no project for the files under
 * `scripts/`, opened them in a project it invented, and answered with
 * errors that the compiler did not report: "Cannot find name
 * 'node:fs'", because the invented project had no node types.
 *
 * The project now lives in `scripts/tsconfig.json`, next to the sources
 * it covers, like every other project of the repository (one per
 * package, one for the harness, one for the release sources).
 *
 * These are the invariants that keep the two tools on the same
 * configuration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The scripts project, read as JSON. */
function scriptsProject() {
	const path = join(ROOT, "scripts", "tsconfig.json");
	assert.ok(existsSync(path), "the scripts have a project of their own");
	return JSON.parse(readFileSync(path, "utf8"));
}

test("the scripts of the repository have a project next to their sources", () => {
	assert.ok(
		existsSync(join(ROOT, "scripts", "tsconfig.json")),
		"scripts/tsconfig.json exists",
	);
	assert.ok(
		!existsSync(join(ROOT, "tsconfig.scripts.json")),
		"the old config with a name of its own at the root is gone",
	);
});

test("the scripts project gives the language server the node types", () => {
	const project = scriptsProject();
	const types = project.compilerOptions?.types ?? [];
	assert.ok(
		Array.isArray(types) && types.includes("node"),
		"the project has the node types, so a file under scripts/ resolves node:fs",
	);
});

test("the scripts project never writes a file", () => {
	// `tsc --noEmit` still writes the .tsbuildinfo of an incremental
	// project. `noEmit` in the project itself is what keeps a type
	// check from writing into the source tree.
	const project = scriptsProject();
	assert.equal(project.compilerOptions?.noEmit, true);
	assert.equal(project.compilerOptions?.allowImportingTsExtensions, true);
});

test("the release sources keep a project of their own", () => {
	const release = JSON.parse(
		readFileSync(join(ROOT, "scripts", "release", "tsconfig.json"), "utf8"),
	);
	assert.equal(release.compilerOptions?.noEmit, true);
	const project = scriptsProject();
	const exclude = project.exclude ?? [];
	assert.ok(
		exclude.some((entry) => entry.includes("release")),
		"the general scripts project leaves the release sources to their own project",
	);
});

test("the type check finds the scripts project", () => {
	const source = readFileSync(
		join(ROOT, "scripts", "typecheck-packages.mjs"),
		"utf8",
	);
	assert.match(
		source,
		/"harness", "scripts", "scripts\/release"/,
		"the discovery of the projects names the folder of the scripts",
	);
	assert.doesNotMatch(
		source,
		/tsconfig\.scripts\.json/,
		"nothing points at the old config with a name of its own",
	);
});

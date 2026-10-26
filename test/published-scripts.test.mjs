/**
 * The published scripts must be safe to import, and they must still run.
 *
 * Three scripts ship in the npm package: the postinstall hook that copies
 * the plugin, the skill sync and the qdrant sync. A consumer may import
 * them - the package is a library as well as a program - and an import
 * must not copy files into the home directory of the machine that
 * imported it, and it must not end the importing process.
 *
 * The scripts therefore run only when the file is the entry point, the
 * same rule the harness programs and the command modules follow.
 *
 * The test reads the script list from the manifest, so a script that is
 * published later is covered without a change here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/** A test that starts processes has to say how long it may take. */
const TEST_TIMEOUT_MS = 120_000;

/** The published scripts, from the manifest. */
function publishedScripts() {
	const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
	const entries = Array.isArray(manifest.files) ? manifest.files : [];
	const scripts = [];
	for (const entry of entries) {
		if (typeof entry !== "string") continue;
		// a root-anchored entry carries the leading slash
		const relative = entry.replace(/^\/+/, "");
		if (!relative.startsWith("scripts/")) continue;
		if (!relative.endsWith(".ts") && !relative.endsWith(".js")) continue;
		if (!existsSync(join(repo, relative))) continue;
		scripts.push(relative);
	}
	return scripts;
}

/** A scratch home, so a script cannot touch the home of the machine. */
function scratchHome() {
	return mkdtempSync(join(tmpdir(), "published-scripts-"));
}

/**
 * Import a script in a child process.
 *
 * The importer is another module, so the script is not the entry point and
 * its program must not run.
 */
function importScript(relative, home) {
	const file = pathToFileURL(join(repo, relative)).href;
	const code = `import(${JSON.stringify(file)}).then(() => {}, (error) => { console.error(String(error)); process.exit(1); });`;
	const result = spawnSync(process.execPath, ["-e", code], {
		cwd: repo,
		encoding: "utf8",
		timeout: TEST_TIMEOUT_MS - 10_000,
		env: { ...process.env, HOME: home, USERPROFILE: home },
	});
	return {
		status: result.status,
		output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
	};
}

/** Run a script as a program. */
function runScript(relative, args, home) {
	const result = spawnSync(process.execPath, [join(repo, relative), ...args], {
		cwd: repo,
		encoding: "utf8",
		timeout: TEST_TIMEOUT_MS - 10_000,
		env: { ...process.env, HOME: home, USERPROFILE: home },
	});
	return {
		status: result.status,
		output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
	};
}

test("the manifest publishes the runtime scripts", { timeout: TEST_TIMEOUT_MS }, () => {
	const scripts = publishedScripts();
	assert.deepEqual(scripts.sort(), [
		"scripts/copy-plugins.js",
		"scripts/sync-skills.ts",
		"scripts/sync-to-qdrant.ts",
	]);
});

test("importing a published script does not run the program", { timeout: TEST_TIMEOUT_MS }, () => {
	for (const relative of publishedScripts()) {
		const home = scratchHome();
		const result = importScript(relative, home);
		assert.equal(result.status, 0, `${relative} did not import cleanly: ${result.output}`);
		assert.equal(
			result.output.trim(),
			"",
			`${relative} did something when it was imported: ${result.output}`,
		);
	}
});

test("importing the plugin copy does not write into the home directory", { timeout: TEST_TIMEOUT_MS }, () => {
	const home = scratchHome();
	const result = importScript("scripts/copy-plugins.js", home);
	assert.equal(result.status, 0, result.output);
	assert.equal(
		existsSync(join(home, ".config", "herdr", "plugins")),
		false,
		"the import copied the plugin into the home directory",
	);
});

test("importing the skill sync does not write into the home directory", { timeout: TEST_TIMEOUT_MS }, () => {
	const home = scratchHome();
	const result = importScript("scripts/sync-skills.ts", home);
	assert.equal(result.status, 0, result.output);
	assert.equal(
		existsSync(join(home, ".pi-harness-runtime", "skills")),
		false,
		"the import synced skills into the home directory",
	);
});

test("the plugin copy still runs as a program", { timeout: TEST_TIMEOUT_MS }, () => {
	const home = scratchHome();
	const result = runScript("scripts/copy-plugins.js", [], home);
	assert.equal(result.status, 0, result.output);
	assert.match(result.output, /Done!/);
	assert.equal(
		existsSync(join(home, ".config", "herdr", "plugins", "herdr-clipboard")),
		true,
		"the program did not copy the plugin",
	);
});

test("the skill sync still runs as a program", { timeout: TEST_TIMEOUT_MS }, () => {
	const home = scratchHome();
	const source = mkdtempSync(join(tmpdir(), "published-skill-source-"));
	const target = join(home, "skills");
	mkdirSync(join(source, "demo-skill"), { recursive: true });
	writeFileSync(join(source, "demo-skill", "SKILL.md"), "---\nname: demo-skill\n---\n", "utf8");

	const result = runScript("scripts/sync-skills.ts", ["--from", source, "--to", target], home);
	assert.equal(result.status, 0, result.output);
	assert.match(result.output, /demo-skill/);
	assert.equal(existsSync(join(target, "demo-skill", "SKILL.md")), true, "the program did not sync the skill");
});

test("the qdrant sync still answers --help as a program", { timeout: TEST_TIMEOUT_MS }, () => {
	const home = scratchHome();
	const result = runScript("scripts/sync-to-qdrant.ts", ["--help"], home);
	assert.equal(result.status, 0, result.output);
	assert.match(result.output, /Sync Skills to Qdrant/);
});

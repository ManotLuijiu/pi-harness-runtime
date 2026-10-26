/**
 * Every published source file must be loadable by the loader the runtime
 * actually uses.
 *
 * The package ships its TypeScript sources next to the compiled
 * JavaScript, and the runtime loads them with jiti. Plain node cannot
 * load them: its type stripping refuses files under `node_modules`, and
 * it does not map a `.js` specifier to a `.ts` file. jiti does both.
 *
 * So the sweep loads every published source with jiti - the loader the
 * runtime uses - and finds two classes of defect that neither the
 * type checker nor the compiled-module sweep can see:
 *
 *   - a module that does work at import time. Three of the harness
 *     programs started their polling loop, so importing them never
 *     returned; two more parsed the command line and exited the
 *     importing process.
 *   - a module that the loader cannot resolve. The published source of
 *     one package re-exported a name that its own import statement
 *     introduced *after* the export statement. The type checker accepts
 *     that, and so does the compiler, but the loader does not: the name
 *     is not defined when the module is evaluated.
 *
 * The rule is the same as for the compiled modules: a module that a
 * consumer may import does nothing at import time, and it loads.
 *
 * One child process per file, with a timeout, because a file that blocks
 * at import time must not block the sweep, and one broken file must not
 * hide the others.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/** How long a single file may take to load. */
const TIMEOUT_MS = 20_000;

/**
 * How long the whole sweep may take.
 *
 * The default timeout of a test is five seconds, and this sweep starts
 * one process per file. A test that needs longer has to say so, or it
 * fails on a slow machine while it passes on a fast one.
 */
const TEST_TIMEOUT_MS = 300_000;

/** How many files load at the same time. */
const CONCURRENCY = 8;

/**
 * The published source surface.
 *
 * The root files and the harness are the runtime; the entry source of
 * every package is what a consumer reaches when the package is used
 * from source. The `scripts/` directory holds programs: they are meant
 * to be run, and a script that runs when it is imported is not a defect.
 */
function collectSourceFiles() {
	const files = [];

	for (const entry of readdirSync(repo, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
		files.push(join(repo, entry.name));
	}

	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
				walk(full);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
			if (entry.name.endsWith(".test.ts")) continue;
			files.push(full);
		}
	};
	walk(join(repo, "harness"));

	const packagesDir = join(repo, "packages");
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const index = join(packagesDir, entry.name, "src", "index.ts");
		if (existsSync(index)) files.push(index);
	}

	return files;
}

const scratch = mkdtempSync(join(tmpdir(), "published-source-load-"));
/**
 * The loader lives inside the repository.
 *
 * It imports jiti by name, and node resolves that name from the location
 * of the importing file - a loader in the temporary directory would not
 * find the repository's node_modules.
 */
const loaderDir = join(repo, "node_modules", ".cache", "published-source-load");
mkdirSync(loaderDir, { recursive: true });
const loader = join(loaderDir, "loader.mjs");
writeFileSync(
	loader,
	`import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
await jiti.import(process.argv[2]);
process.stdout.write("LOADED\\n");
`,
	"utf8",
);

function loadOne(file) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [loader, file], {
			cwd: repo,
			env: { ...process.env, HOME: scratch, USERPROFILE: scratch },
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
		}, TIMEOUT_MS);
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({
				file,
				ok: code === 0 && !signal,
				signal,
				reason: stderr.split("\n").filter((line) => line.trim()).slice(0, 3).join(" | "),
			});
		});
	});
}

test("every published source file loads with the runtime loader", { timeout: TEST_TIMEOUT_MS }, async () => {
	const files = collectSourceFiles();
	assert.ok(files.length > 100, `only ${files.length} source file(s) were found`);

	const results = [];
	let index = 0;
	const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
		while (index < files.length) {
			const current = files[index++];
			results.push(await loadOne(current));
		}
	});
	await Promise.all(workers);

	const failed = results.filter((result) => !result.ok);
	assert.equal(
		failed.length,
		0,
		failed
			.map(
				(result) =>
					`${relative(repo, result.file)}: ${result.signal ? `blocked (${result.signal})` : result.reason}`,
			)
			.join("\n"),
	);

	rmSync(scratch, { recursive: true, force: true });
	rmSync(loaderDir, { recursive: true, force: true });
});

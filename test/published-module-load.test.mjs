/**
 * Every published module must be importable.
 *
 * A module that throws at import time breaks as soon as anything reaches
 * it - and "anything" is a consumer, long after the release. The entry
 * point check cannot see this: it imports the package's entry points,
 * not the hundreds of modules behind them.
 *
 * The sweep that found the first defect of this kind loaded every
 * published module of an installed package. One of them failed: a
 * command that validated its configuration at module scope, so importing
 * it started a sync and terminated the importing process. The module
 * also printed its help text and exited while it was being imported.
 *
 * So the rule is: a module that a consumer may import does nothing at
 * import time. The command is the part that decides to run.
 *
 * One child process per module, with a timeout, because a module that
 * blocks at import time must not block the sweep, and one broken module
 * must not hide the others.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/** The compiled packages are the published JavaScript. */
const PUBLISHED_ROOTS = [join(repo, "packages")];

/** How long a single module may take to load. */
const TIMEOUT_MS = 10_000;

/** How many modules load at the same time. */
const CONCURRENCY = 8;

function collectJsFiles(root) {
	const files = [];
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
				if (entry.name === "node_modules" || entry.name === ".bin") continue;
				walk(full);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
		}
	};
	walk(root);
	return files;
}

const scratch = mkdtempSync(join(tmpdir(), "published-module-load-"));
const loader = join(scratch, "loader.mjs");
writeFileSync(
	loader,
	`await import(process.argv[2]);\n`,
	"utf8",
);

function loadOne(file) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [loader, pathToFileURL(file).href], {
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

test("every published module imports", async () => {
	const files = PUBLISHED_ROOTS.flatMap(collectJsFiles);
	assert.ok(files.length > 100, `only ${files.length} module(s) were found`);

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
});

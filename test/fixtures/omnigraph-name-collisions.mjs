/**
 * The names that the cache writes for a catalog with colliding names.
 *
 * The script is run in a subprocess by the regression: a hang in the
 * allocation of the names is a synchronous loop, and only a process that
 * is killed from the outside can end such a loop.
 *
 * It prints one name per line, in the order of the catalog.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stubRoot, writeStubs } from "../../harness/omnigraph/cache.ts";

/** The catalog of the run: the names collide on purpose. */
const longName = "a".repeat(64);
const entries = [
	{
		id: "the-first",
		name: longName,
		description: "the first skill",
		revision: "abc123",
		sha256: "a".repeat(64),
	},
	{
		id: "the-second",
		name: longName,
		description: "the second skill",
		revision: "abc123",
		sha256: "b".repeat(64),
	},
	{
		id: "the-third",
		name: `${longName}-and-more`,
		description: "the third skill",
		revision: "abc123",
		sha256: "c".repeat(64),
	},
];

const dir = mkdtempSync(join(tmpdir(), "omnigraph-names-"));
try {
	// The advertising limit is applied after the names are allocated, so
	// "0" must not change the behaviour of the allocation.
	const advertised = process.argv[2] === "0" ? 0 : undefined;
	writeStubs(dir, entries, advertised);
	const root = stubRoot(dir);
	for (const id of readdirSync(root).sort()) {
		const markdown = readFileSync(join(root, id, "SKILL.md"), "utf8");
		const name = /^name:\s*"(.*)"$/m.exec(markdown)?.[1] ?? "";
		console.log(`${id} ${name}`);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

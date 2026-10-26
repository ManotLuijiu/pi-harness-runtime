/**
 * CLI for indexing SKILL.md files (RFC-0106)
 *
 * Usage:
 *   bun run index [directory] [--output <file>] [--format json|codegraph]
 *
 * The command does its work when it is run, not when it is imported. A
 * module that indexes a directory at import time makes every importer
 * pay for it - and the directory it indexes is the working directory of
 * whoever imported the module.
 */

import { pathToFileURL } from "node:url";
import { indexDirectory, toCodeGraph, type OKFDocument } from "./indexer.js";

/**
 * Run the command.
 */
export async function main(
	args: string[] = process.argv.slice(2),
): Promise<void> {
	const dir = args[0] || ".";
	const outputArg = args.indexOf("--output");
	const outputFile = outputArg >= 0 ? args[outputArg + 1] : null;

	const docs = indexDirectory(dir);
	console.error(`Indexed ${docs.length} skills from ${dir}`);

	if (outputFile) {
		const fs = await import("node:fs");
		const data = docs.map((d: OKFDocument) => ({ ...d, _graph: toCodeGraph(d) }));
		fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
		console.error(`Written to ${outputFile}`);
	} else {
		console.log(JSON.stringify(docs, null, 2));
	}
}

// The command runs only when this file is the entry point.
const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(
			`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	});
}

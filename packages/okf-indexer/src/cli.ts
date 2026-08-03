/**
 * CLI for indexing SKILL.md files (RFC-0106)
 *
 * Usage:
 *   bun run index [directory] [--output <file>] [--format json|codegraph]
 */

import { indexDirectory, toCodeGraph, type OKFDocument } from "./indexer.js";

const args = process.argv.slice(2);
const dir = args[0] || ".";
const outputArg = args.indexOf("--output");
const outputFile = outputArg >= 0 ? args[outputArg + 1] : null;

const docs = indexDirectory(dir);
console.error(`Indexed ${docs.length} skills from ${dir}`);

if (outputFile) {
  const fs = await import("node:fs");
  const data = docs.map((d) => ({ ...d, _graph: toCodeGraph(d) }));
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
  console.error(`Written to ${outputFile}`);
} else {
  console.log(JSON.stringify(docs, null, 2));
}

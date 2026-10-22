import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "./helpers/strip-types.mjs";

// The syntax check must run with node: `bun --check` is not a syntax check
// mode (it prints the usage banner and exits 0 for any input), so using
// `process.execPath` would make this test pass for the wrong reason when
// the suite runs under bun.
const nodeBin = process.env.NODE_BIN ?? "node";

function checkSyntax(javascript) {
	return spawnSync(nodeBin, ["--check", "--input-type=module"], {
		input: javascript,
		encoding: "utf8",
	});
}

test("extension entry point parses as a JavaScript module", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const javascript = stripTypeScriptTypes(source, { mode: "transform" });
	const result = checkSyntax(javascript);
	assert.equal(result.status, 0, result.stderr);
});

test("the syntax checker rejects broken JavaScript", () => {
	// Guards the test above: a checker that accepts everything would make
	// it pass without ever looking at the extension entry point.
	const result = checkSyntax("const broken = ;\n");
	assert.notEqual(result.status, 0, "the syntax checker accepted broken JavaScript");
});

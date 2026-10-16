import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { spawnSync } from "node:child_process";

test("extension entry point parses as a JavaScript module", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const javascript = stripTypeScriptTypes(source, { mode: "transform" });
	const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
		input: javascript,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
});

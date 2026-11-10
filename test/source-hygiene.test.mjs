/**
 * A source file must stay text.
 *
 * A raw control byte in a source file turns it into a binary file for
 * grep, for diff and for the file command: the content then hides from
 * every tool that reads it. The request scope shipped such a byte (the
 * separator of the baseline of a request), and the review pass did not see
 * the file at all - the byte hid it.
 *
 * The rule: a source file carries no raw control byte. The escape sequence
 * of the character is the way to write it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

/** The sources this rule covers. */
function sourceFiles() {
	const files = [join(root, "index.ts")];
	const harnessDir = join(root, "harness");
	for (const entry of readdirSync(harnessDir)) {
		if (entry.endsWith(".ts")) files.push(join(harnessDir, entry));
	}
	return files;
}

/** The raw control bytes of a file: the ones that are not a tab or a line break. */
function controlBytes(content) {
	const found = [];
	for (let index = 0; index < content.length; index += 1) {
		const byte = content[index];
		if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
		if (byte < 0x20 || byte === 0x7f) found.push({ index, byte });
	}
	return found;
}

test("a source file of the harness carries no raw control byte", () => {
	const offenders = [];
	for (const file of sourceFiles()) {
		const content = readFileSync(file);
		const found = controlBytes(content);
		if (found.length > 0) {
			offenders.push(
				`${relative(root, file)}: ${found.length} raw control byte(s), the first at offset ${found[0].index} (0x${found[0].byte.toString(16)})`,
			);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		"a raw control byte makes the file a binary file for grep and for diff",
	);
});

test("the file command reads the sources of the harness as text", () => {
	// The rule above is about the bytes; this one is about the effect: a
	// reader that classifies the file by its content has to see text.
	const offenders = [];
	for (const file of sourceFiles()) {
		let kind = "";
		try {
			kind = execFileSync("file", ["-b", file], { encoding: "utf8" }).trim();
		} catch {
			continue;
		}
		if (/data|binary/i.test(kind)) offenders.push(`${relative(root, file)}: ${kind}`);
	}
	assert.deepEqual(offenders, [], "the file command has to read the source as text");
});

test("the separator of the baseline of a request is written as an escape", () => {
	const source = readFileSync(join(root, "harness", "jev-request-scope.ts"), "utf8");
	assert.ok(
		source.includes("\\0"),
		"the separator is written as the escape sequence and not as a raw byte",
	);
});

/**
 * A source file must stay text.
 *
 * A raw control byte in a source file turns it into a binary file for
 * grep, for diff and for the file command: the content then hides from
 * every tool that reads it. The request scope shipped such a byte (the
 * separator of the baseline of a request), and the review pass did not see
 * the file at all - the byte hid it.
 *
 * The rule: a source of the repository carries no raw control byte. The
 * escape sequence of the character is the way to write it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

/** The directories whose sources are covered. */
const SOURCE_DIRS = ["harness", "scripts", "test"];

/** The extensions of a source file. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"];

/** Every file of a directory, recursively. */
function filesOf(directory) {
	if (!existsSync(directory)) return [];
	const found = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) {
			found.push(...filesOf(path));
			continue;
		}
		if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
			found.push(path);
		}
	}
	return found;
}

/**
 * Every source of the repository.
 *
 * The sources of the packages and the built output that ships with them
 * are included: the tarball carries the compiled files, so a raw byte
 * there is a byte in the hands of a consumer.
 */
function sourceFiles() {
	const files = [join(root, "index.ts")];
	for (const directory of SOURCE_DIRS) {
		files.push(...filesOf(join(root, directory)));
	}
	const packages = join(root, "packages");
	if (existsSync(packages)) {
		for (const entry of readdirSync(packages)) {
			for (const directory of ["src", "dist"]) {
				files.push(...filesOf(join(packages, entry, directory)));
			}
		}
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

test("a source of the repository carries no raw control byte", () => {
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
	const files = [join(root, "index.ts")];
	for (const entry of readdirSync(join(root, "harness"))) {
		if (entry.endsWith(".ts")) files.push(join(root, "harness", entry));
	}
	const offenders = [];
	for (const file of files) {
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

test("the sanitizer of a message writes its control characters as escapes", () => {
	const source = readFileSync(
		join(root, "packages", "logging", "src", "incidents", "schema.ts"),
		"utf8",
	);
	assert.ok(
		source.includes("\\u0000"),
		"the character class is written with escape sequences and not with raw bytes",
	);
});

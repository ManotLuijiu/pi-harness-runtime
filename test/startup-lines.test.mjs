/**
 * Tests for the startup summary lines.
 *
 * A fix command that does not fit into the terminal must not be truncated -
 * the user would copy a broken path. It is split into two lines instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderDetailLines } from "../harness/startup-lines.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

test("a command that fits stays on one line", () => {
	const lines = renderDetailLines('echo "<TOKEN>" > ~/keys/telegram-bot-token.txt', "│  ", 120);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /^│ {3}Fix: echo "<TOKEN>"/);
});

test("a command that does not fit is split into a directory and a command", () => {
	const lines = renderDetailLines(
		'echo "<API_KEY>" > ~/.pi-harness-runtime/keys/openrouter-api-key.txt',
		"│  ",
		60,
	);
	assert.ok(lines.length >= 2, `expected a split, got ${JSON.stringify(lines)}`);
	assert.match(lines[0], /Fix: mkdir -p ~\/\.pi-harness-runtime\/keys$/);
	// The command keeps the full path - no `cd`, so pasting it does not
	// change the working directory of the user's shell.
	const joined = lines.join(" ");
	assert.match(joined, /echo "<API_KEY>"/);
	assert.match(joined, /> ~\/\.pi-harness-runtime\/keys\/openrouter-api-key\.txt/);
	assert.ok(!lines.some((line) => /(^|\s)cd\s/.test(line)), `no cd in the split: ${JSON.stringify(lines)}`);
	for (const line of lines) {
		// A line that does not fit is wrapped by the terminal - but it must
		// never be cut in the middle.
		assert.ok(
			visibleWidth(line) <= 60 || !line.includes("\u2026"),
			`the line fits into the width or is not cut: ${line}`,
		);
	}
});

test("the empty note survives the split", () => {
	const lines = renderDetailLines(
		'echo "<SECRET>" > ~/.pi-harness-runtime/keys/telegram-webhook-secret.txt   # the file exists but is empty',
		"│  ",
		80,
	);
	assert.ok(lines.length >= 3, `expected a split, got ${JSON.stringify(lines)}`);
	const joined = lines.join(" ");
	assert.match(joined, /echo "<SECRET>"/);
	assert.match(joined, /> ~\/\.pi-harness-runtime\/keys\/telegram-webhook-secret\.txt/);
	assert.ok(lines.some((line) => /# the file exists but is empty$/.test(line)), `the note survives: ${JSON.stringify(lines)}`);
});

test("a prose detail is not prefixed with Fix:", () => {
	const lines = renderDetailLines("Then reload Pi.", "│  ", 80);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /Then reload Pi\.$/);
	assert.ok(!lines[0].includes("Fix:"), "a prose line does not read like a command");
});

test("a detail that cannot be split is truncated", () => {
	const lines = renderDetailLines("echo <not-a-quoted-placeholder> > some/really/long/path.txt", "│  ", 40);
	assert.equal(lines.length, 1);
	assert.ok(visibleWidth(lines[0]) <= 40);
});

test("a narrow terminal splits the command further instead of cutting it", () => {
	const lines = renderDetailLines(
		'echo "<WEBHOOK_URL>" > ~/.pi-harness-runtime/keys/telegram-webhook-url.txt',
		"│  ",
		40,
	);
	assert.ok(lines.length >= 2, `expected a split, got ${JSON.stringify(lines)}`);
	for (const line of lines) {
		// A cut command is worse than no command - the path must be whole.
		// A line that is too long for the terminal is wrapped by the
		// terminal, it is never cut in the middle.
		assert.ok(!line.includes("…"), `the command is not cut: ${line}`);
	}
	// The redirect is still part of the command.
	const joined = lines.join(" ");
	assert.match(joined, /echo "<WEBHOOK_URL>"/);
	assert.match(joined, /> \S*telegram-webhook-url\.txt/);
});

test("a very narrow terminal never cuts the command", () => {
	const lines = renderDetailLines(
		'echo "<WEBHOOK_URL>" > ~/.pi-harness-runtime/keys/telegram-webhook-url.txt',
		"│  ",
		20,
	);
	const joined = lines.join(" ");
	assert.match(joined, /echo "<WEBHOOK_URL>"/);
	assert.match(joined, /> \S*telegram-webhook-url\.txt/);
	for (const line of lines) {
		assert.ok(!line.includes("…"), `the command is not cut: ${line}`);
	}
});

test("the note is kept on its own line", () => {
	const lines = renderDetailLines(
		'echo "<SECRET>" > ~/.pi-harness-runtime/keys/telegram-webhook-secret.txt   # the file exists but is empty',
		"│  ",
		40,
	);
	assert.ok(lines.some((line) => line.includes("# the file exists but is empty")));
});

test("the split lines are valid shell when pasted in order", () => {
	const lines = renderDetailLines(
		'echo "<API_KEY>" > ~/.pi-harness-runtime/keys/openrouter-api-key.txt',
		"│  ",
		60,
	);
	const commands = lines.map((line) => line.replace(/^│\s*/, "").replace(/^Fix:\s*/, ""));
	// The directory is created before the file is written into it.
	const mkdirIndex = commands.findIndex((line) => line.startsWith("mkdir -p "));
	const echoIndex = commands.findIndex((line) => line.startsWith("echo "));
	assert.ok(mkdirIndex >= 0, `the directory is created: ${JSON.stringify(commands)}`);
	assert.ok(echoIndex > mkdirIndex, `the file is written after the directory exists: ${JSON.stringify(commands)}`);
	// The redirect targets the full path - the command does not change the
	// working directory of the user's shell. The redirect may sit on the
	// next line (a backslash continuation), never inside a path.
	const redirectIndex = commands.findIndex((line) => line.startsWith("> "));
	assert.ok(redirectIndex > echoIndex, `the redirect follows the echo: ${JSON.stringify(commands)}`);
	const redirect = commands[redirectIndex].replace(/^>\s*/, "");
	assert.match(redirect, /^\S*\/\S+$/, `the redirect is a full path: ${redirect}`);
	assert.ok(!commands.some((line) => line.startsWith("cd ")), `no cd: ${JSON.stringify(commands)}`);
	// Pasting the lines in order is valid shell: the directory exists before
	// the redirect writes into it, and the continuation keeps it one command.
	const pasted = commands.join("\n");
	assert.ok(pasted.includes("mkdir -p "), `the directory is created: ${pasted}`);
	assert.ok(/echo "[^"]+" (\\\n)?/.test(pasted), `the echo is one command: ${pasted}`);
});

test("a prose detail that carries a path keeps the path on its own line", () => {
	const lines = renderDetailLines(
		"The file exists - check its value: ~/.pi-harness-runtime/keys/telegram-bot-token.txt",
		"│  ",
		80,
	);
	assert.equal(lines.length, 2, `the prose and the path are on two lines: ${JSON.stringify(lines)}`);
	assert.match(lines[0], /The file exists/);
	assert.match(lines[1], /~\/\.pi-harness-runtime\/keys\/telegram-bot-token\.txt$/);
	assert.ok(!lines[1].includes("\u2026"), "the path is not cut");
});

test("the path line is never cut, not even in a very narrow terminal", () => {
	const path = "~/.pi-harness-runtime/keys/telegram-bot-token.txt";
	const lines = renderDetailLines(`The file exists - check its value: ${path}`, "│  ", 20);
	assert.ok(
		lines.some((line) => line.trimEnd().endsWith(path)),
		`the path survives the narrow terminal: ${JSON.stringify(lines)}`,
	);
});

test("a path in the middle of a prose detail survives a narrow terminal", () => {
	const path = "~/.pi-harness-runtime/keys/";
	const lines = renderDetailLines(`Configure LINE in ${path}, then reload Pi.`, "│  ", 40);
	const joined = lines.join("\n");
	assert.ok(joined.includes(path), `the path survives: ${JSON.stringify(lines)}`);
	assert.ok(
		joined.toLowerCase().includes("reload"),
		`the instruction survives: ${JSON.stringify(lines)}`,
	);
});

test("the note that warns about an overwrite survives a narrow terminal", () => {
	const note = "# the file exists but is empty - the command replaces it";
	const lines = renderDetailLines(
		`echo "<SECRET>" > ~/.pi-harness-runtime/keys/telegram-webhook-secret.txt   ${note}`,
		"│  ",
		40,
	);
	const joined = lines.join("\n");
	assert.ok(joined.includes("replaces it"), `the warning survives: ${JSON.stringify(lines)}`);
	assert.ok(
		joined.includes("telegram-webhook-secret.txt"),
		`the command is not cut: ${JSON.stringify(lines)}`,
	);
});

test("the path carries no trailing punctuation", () => {
	const lines = renderDetailLines(
		"Configure LINE in ~/.pi-harness-runtime/keys/, then reload Pi.",
		"│  ",
		40,
	);
	const pathLine = lines.find((line) => line.includes("~/.pi-harness-runtime"));
	assert.ok(pathLine, `the path is on a line of its own: ${JSON.stringify(lines)}`);
	assert.ok(
		pathLine.trimEnd().endsWith("~/.pi-harness-runtime/keys/"),
		`the path is not glued to the punctuation: ${JSON.stringify(lines)}`,
	);
});

test("a list of file names in the tail is not cut", () => {
	const lines = renderDetailLines(
		"Check the LINE credentials in ~/.pi-harness-runtime/keys/ (line-access-token.txt, line-user-id.txt).",
		"│  ",
		40,
	);
	const joined = lines.join("\n");
	assert.ok(joined.includes("line-access-token.txt"), `the first file name survives: ${JSON.stringify(lines)}`);
	assert.ok(joined.includes("line-user-id.txt"), `the second file name survives: ${JSON.stringify(lines)}`);
});

test("an alternative is not lost when the prose does not fit", () => {
	const lines = renderDetailLines(
		"Or set TYPESAFE_API_KEY (or OPENROUTER_API_KEY) in the environment.",
		"│  ",
		40,
	);
	const joined = lines.join("\n");
	assert.ok(joined.includes("TYPESAFE_API_KEY"), `the first option survives: ${JSON.stringify(lines)}`);
	assert.ok(joined.includes("OPENROUTER_API_KEY"), `the alternative survives: ${JSON.stringify(lines)}`);
});

test("a long word without a separator is wrapped, not cut", () => {
	const lines = renderDetailLines(
		"The LINE channel starts together with the Telegram channel - the key files were created after Pi was loaded.",
		"│  ",
		40,
	);
	const joined = lines.join("\n");
	assert.ok(joined.includes("Telegram channel"), `no word is cut: ${JSON.stringify(lines)}`);
	assert.ok(joined.includes("loaded"), `the tail survives: ${JSON.stringify(lines)}`);
	assert.ok(!joined.includes("…"), `nothing is cut: ${JSON.stringify(lines)}`);
});

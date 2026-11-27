/**
 * The progress of a request that the harness observes.
 *
 * The counter is the bounded evidence that a chunk which edits files is
 * working, even when the todo list does not change. The tests are about
 * the classification of the calls: a reading call is never progress.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	RequestProgress,
	changesFiles,
} from "../harness/request-progress.ts";

test("a call that edits a file changes a file", () => {
	assert.equal(changesFiles("edit", { filePath: "a.ts" }), true);
	assert.equal(changesFiles("write", { path: "a.ts" }), true);
});

test("a call that reads a file changes nothing", () => {
	assert.equal(changesFiles("read", { path: "a.ts" }), false);
	assert.equal(changesFiles("grep", { pattern: "x" }), false);
	assert.equal(changesFiles("ls", { path: "." }), false);
	assert.equal(changesFiles("todo", { action: "list" }), false);
});

test("a shell call that writes changes a file", () => {
	assert.equal(changesFiles("bash", { command: "rm -f packages/a/dist/x.js" }), true);
	assert.equal(changesFiles("bash", { command: "git checkout -- packages/a/x.ts" }), true);
	assert.equal(changesFiles("bash", { command: "mkdir -p out" }), true);
	assert.equal(changesFiles("bash", { command: "cat a.ts > b.ts" }), true);
	assert.equal(changesFiles("bash", { command: "sed -i s/a/b/ a.ts" }), true);
});

test("a shell call that reads changes nothing", () => {
	assert.equal(changesFiles("bash", { command: "ls packages" }), false);
	assert.equal(changesFiles("bash", { command: "cat packages/a/x.ts" }), false);
	assert.equal(changesFiles("bash", { command: "git status" }), false);
	// A comparison is not a redirection.
	assert.equal(changesFiles("bash", { command: "diff a.ts b.ts" }), false);
});

test("a call without an input changes nothing", () => {
	assert.equal(changesFiles("bash", undefined), false);
	assert.equal(changesFiles("", undefined), false);
});

test("the counter of the progress grows with every change", () => {
	const progress = new RequestProgress();
	assert.equal(progress.token(), "");
	progress.noteChange();
	assert.equal(progress.token(), "c1");
	assert.equal(progress.changeCount, 1);
	progress.noteChange();
	assert.equal(progress.token(), "c2");
	assert.equal(progress.changeCount, 2);
});

test("a new request starts with an empty counter", () => {
	const progress = new RequestProgress();
	progress.noteChange();
	progress.noteChange();
	progress.reset();
	assert.equal(progress.token(), "");
	assert.equal(progress.changeCount, 0);
});

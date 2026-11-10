/**
 * The lookup of the command line tools the harness uses.
 *
 * The startup tells the user that the harness keeps its issues with bd
 * (beads), and how to install it when it is missing. The lookup must find
 * the tool on the path of the environment, and it must not run the tool
 * while it looks for it: a tool that hangs would hang the startup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	findOnPath,
	versionNumber,
} from "../harness/tool-availability.ts";

test("a command is found on the path", () => {
	const found = findOnPath("bd", {
		path: "/usr/local/bin:/usr/bin",
		platform: "linux",
		exists: (candidate) => candidate === "/usr/bin/bd",
	});
	assert.equal(found, "/usr/bin/bd");
});

test("a command that is not on the path is not found", () => {
	const found = findOnPath("bd", {
		path: "/usr/local/bin:/usr/bin",
		platform: "linux",
		exists: () => false,
	});
	assert.equal(found, null);
});

test("an empty path finds nothing", () => {
	assert.equal(findOnPath("bd", { path: "", exists: () => true }), null);
});

test("the first directory of the path wins", () => {
	const found = findOnPath("bd", {
		path: "/first:/second",
		platform: "linux",
		exists: (candidate) => candidate === "/first/bd" || candidate === "/second/bd",
	});
	assert.equal(found, "/first/bd");
});

test("a command that cannot be run is not a command", () => {
	const found = findOnPath("bd", {
		path: "/usr/bin",
		platform: "linux",
		// The file is there but it cannot be run.
		exists: () => false,
	});
	assert.equal(found, null);
});

test("the extensions of Windows are tried", () => {
	const seen = [];
	const found = findOnPath("bd", {
		path: "C:\\tools",
		platform: "win32",
		pathext: ".CMD;.EXE",
		exists: (candidate) => {
			seen.push(candidate);
			return candidate.endsWith(".EXE");
		},
	});
	assert.ok(seen.some((candidate) => candidate.endsWith(".CMD")));
	assert.ok(found ? found.endsWith(".EXE") : false);
});

test("the version number is taken from the line of the tool", () => {
	assert.equal(versionNumber("bd version 1.1.2 (20e493e56)"), "1.1.2");
	assert.equal(versionNumber("bd 1.1.503"), "1.1.503");
});

test("a line without a version has no version number", () => {
	assert.equal(versionNumber("bd"), undefined);
	assert.equal(versionNumber(undefined), undefined);
});

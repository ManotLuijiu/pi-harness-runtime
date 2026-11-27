/**
 * The bench of the workspace.
 *
 * The tool of the Frappe lifecycle reads the files of a bench, so it has
 * to find the right one and refuse the wrong one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findBench, isBench } from "../harness/frappe-bench.ts";

/**
 * A bench in a directory.
 */
function makeBench(root, name = "frappe-bench") {
	const path = join(root, name);
	mkdirSync(join(path, "apps"), { recursive: true });
	mkdirSync(join(path, "sites"), { recursive: true });
	return path;
}

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "frappe-bench-"));
}

test("a directory with the apps and the sites is a bench", () => {
	const root = temporary();
	try {
		const bench = makeBench(root);
		assert.equal(isBench(bench), true);
		assert.equal(isBench(root), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a directory with only the apps is not a bench", () => {
	const root = temporary();
	try {
		mkdirSync(join(root, "apps"), { recursive: true });
		assert.equal(isBench(root), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the environment names the bench", () => {
	const root = temporary();
	try {
		const bench = makeBench(root, "other-bench");
		const found = findBench(root, { PI_FRAPPE_BENCH: bench });
		assert.equal(found, bench);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an environment that names no bench is ignored", () => {
	const root = temporary();
	try {
		const bench = makeBench(root, "other-bench");
		const found = findBench(root, { PI_FRAPPE_BENCH: join(root, "nowhere") });
		assert.equal(found, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a parent of the workspace may be the bench", () => {
	const root = temporary();
	try {
		const bench = makeBench(root);
		const workspace = join(root, "workspace");
		mkdirSync(workspace, { recursive: true });
		assert.equal(findBench(workspace, {}), bench);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a frappe-bench next to the workspace is the bench", () => {
	const root = temporary();
	try {
		const bench = makeBench(root);
		const workspace = join(root, "workspace");
		mkdirSync(workspace, { recursive: true });
		assert.equal(findBench(workspace, {}), bench);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a workspace without a bench has no bench", () => {
	const root = temporary();
	try {
		const workspace = join(root, "workspace");
		mkdirSync(workspace, { recursive: true });
		assert.equal(findBench(workspace, {}), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

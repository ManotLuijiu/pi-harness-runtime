/// <reference types="bun-types" />
/**
 * The state of the cookie source.
 *
 * The discovery of a file, the import into the canonical cache and the
 * authentication by the provider are three different facts. This module
 * reports the first two.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectCookieSource } from "../src/source-state.js";

let base = "";
let dropDir = "";
let cachePath = "";

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "cookie-source-"));
	dropDir = join(base, "cookies");
	mkdirSync(dropDir, { recursive: true });
	cachePath = join(base, "config", "minimax-cookies.txt");
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("inspectCookieSource", () => {
	it("reports nothing when there is nothing", () => {
		const state = inspectCookieSource({ dropDir, cachePath });
		expect(state.stage).toBe("none");
		expect(state.dropFileCount).toBe(0);
		expect(state.cacheExists).toBe(false);
	});

	it("reports a discovery when a file was found but not imported", () => {
		writeFileSync(join(dropDir, "minimax.txt"), "anything");
		const state = inspectCookieSource({ dropDir, cachePath });
		expect(state.stage).toBe("discovered");
		expect(state.dropFileCount).toBe(1);
		expect(state.cacheExists).toBe(false);
	});

	it("reports an import when the canonical cache exists", () => {
		writeFileSync(join(dropDir, "minimax.txt"), "anything");
		mkdirSync(join(base, "config"), { recursive: true });
		writeFileSync(cachePath, "# a cache\n");
		const state = inspectCookieSource({ dropDir, cachePath });
		expect(state.stage).toBe("imported");
		expect(state.cacheExists).toBe(true);
	});

	it("does not throw on an unreadable folder", () => {
		const state = inspectCookieSource({
			dropDir: join(base, "does-not-exist"),
			cachePath,
		});
		expect(state.stage).toBe("none");
	});
});

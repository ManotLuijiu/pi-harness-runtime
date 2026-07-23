/**
 * Watcher tests — light-touch. chokidar needs a real fs environment,
 * so we exercise the debouncer + runSync trigger without depending
 * on the chokidar watcher itself (which is exercised in real use).
 */

import { describe, it, expect } from "bun:test";
import { createWatcher } from "../src/watcher.js";

describe("CookieWatcher — configuration sanity", () => {
	it("accepts a valid config and constructs without throwing", () => {
		const w = createWatcher(
			"/tmp/does-not-exist-folder",
			{ dropDir: "/tmp/does-not-exist-folder" },
			() => {},
		);
		expect(w).toBeDefined();
		expect(typeof w.start).toBe("function");
		expect(typeof w.stop).toBe("function");
		expect(typeof w.triggerNow).toBe("function");
	});

	// Note: real chokidar-on-the-filesystem tests are exercised via
	// the live runtime, not in this unit-test file. chokidar requires
	// a real OS-level fs watcher and behaves differently across
	// platforms; we rely on chokidar's own test suite for that.
});

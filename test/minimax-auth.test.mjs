import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	authenticateWithPersistentBrowser,
	checkAuthStatus,
	getChromeExecutablePath,
	scrapeWithExistingProfile,
} from "../packages/auth/src/minimax-browser-auth.ts";

/**
 * The candidate list mirrors getChromeExecutablePath() in
 * packages/auth/src/minimax-browser-auth.ts.
 */
function findChromeExecutable() {
	const configured =
		process.env.PI_HARNESS_CHROME_PATH ??
		process.env.GOOGLE_CHROME_BIN ??
		process.env.CHROME_PATH;
	const candidates = configured ? [configured] : [];
	switch (process.platform) {
		case "darwin":
			candidates.push(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
			);
			break;
		case "win32":
			candidates.push(
				join(
					process.env["ProgramFiles"] ?? "C:\\Program Files",
					"Google",
					"Chrome",
					"Application",
					"chrome.exe",
				),
				join(
					process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
					"Google",
					"Chrome",
					"Application",
					"chrome.exe",
				),
				join(
					process.env.LOCALAPPDATA ?? "",
					"Google",
					"Chrome",
					"Application",
					"chrome.exe",
				),
			);
			break;
		default:
			candidates.push(
				"/usr/bin/google-chrome",
				"/usr/bin/google-chrome-stable",
				"/snap/bin/google-chrome",
			);
	}
	return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

const chromeExecutable = findChromeExecutable();

/**
 * The resolver contract is always asserted: it either returns a path that
 * exists, or it fails with the documented error. This keeps the resolver
 * covered on machines without Chrome instead of skipping the whole file.
 */
test("Chrome resolver returns an existing executable or fails with the documented error", () => {
	if (chromeExecutable) {
		const resolved = getChromeExecutablePath();
		assert.ok(existsSync(resolved), `resolved Chrome path must exist: ${resolved}`);
		return;
	}
	assert.throws(
		() => getChromeExecutablePath(),
		/Google Chrome executable not found/,
	);
});

/**
 * The browser flow launches a REAL Chrome and talks to a data: URL, so it is
 * opt-in: it is slow (up to 90s) and needs a real browser. Run it with
 * PI_HARNESS_MINIMAX_AUTH_E2E=1 npm test
 */
test({
	name: "MiniMax auth can launch a persistent Chrome context and persist status",
	timeout: 90_000,
	skip:
		process.env.PI_HARNESS_MINIMAX_AUTH_E2E === "1"
			? false
			: "opt-in: set PI_HARNESS_MINIMAX_AUTH_E2E=1 to run the browser flow",
	async fn() {
		if (!chromeExecutable) {
			throw new Error(
				"Google Chrome is not installed - set PI_HARNESS_CHROME_PATH to run this test",
			);
		}
		const tempRoot = mkdtempSync(join(tmpdir(), "minimax-auth-test-"));
		const profilePath = join(tempRoot, "profile");
		const statusPath = join(tempRoot, "minimax-auth-status.json");
		const targetUrl =
			"data:text/html,<html><body><h1>Usage</h1><div>Credits</div><div>Plan</div><div>quota used</div></body></html>";

		try {
			const status = await authenticateWithPersistentBrowser({
				profilePath,
				statusPath,
				targetUrl,
				authTimeoutMs: 60_000,
				headless: true,
			});

			assert.equal(status.provider, "minimax");
			assert.equal(status.authenticated, true);
			assert.equal(status.profile_path, profilePath);
			assert.match(status.page_url, /^data:text\/html,/);
			assert.ok(status.detected_text_sample);
			assert.ok(existsSync(statusPath), "status file should be written");

			const savedStatus = JSON.parse(readFileSync(statusPath, "utf8"));
			assert.equal(savedStatus.authenticated, true);
			assert.equal(savedStatus.profile_path, profilePath);

			const checked = await checkAuthStatus({ profilePath, statusPath });
			assert.equal(checked.authenticated, true);

			const scraped = await scrapeWithExistingProfile({
				profilePath,
				statusPath,
				targetUrl,
				headless: true,
				forceNoLiveSession: true, // bypass real daemon in test environment
			});
			assert.equal(scraped.authenticated, true);
			assert.match(scraped.page_url, /^data:text\/html,/);
		} finally {
			// Retry cleanup in case Chrome left temp files behind
			for (let i = 0; i < 3; i++) {
				try {
					rmSync(tempRoot, { recursive: true, force: true });
					break;
				} catch {
					/* Chrome may have left temp dirs — ignore cleanup failure */
				}
			}
		}
	},
});

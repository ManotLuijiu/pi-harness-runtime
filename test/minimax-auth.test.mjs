import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	authenticateWithPersistentBrowser,
	checkAuthStatus,
	scrapeWithExistingProfile,
} from "../packages/auth/src/minimax-browser-auth.ts";

test({
	name: "MiniMax auth can launch a persistent Chrome context and persist status",
	timeout: 90_000,
	async fn() {
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

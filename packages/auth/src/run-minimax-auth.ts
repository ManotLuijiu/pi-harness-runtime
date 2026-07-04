#!/usr/bin/env bun
/**
 * run-minimax-auth.ts
 *
 * CLI to authenticate with MiniMax using Playwright persistent browser.
 *
 * Usage:
 *   bun packages/auth/src/run-minimax-auth.ts auth    # First-time: login in browser
 *   bun packages/auth/src/run-minimax-auth.ts scrape  # Scrape usage (silent)
 *   bun packages/auth/src/run-minimax-auth.ts check   # Check status
 *   bun packages/auth/src/run-minimax-auth.ts open    # Open browser with profile
 *
 * Security:
 *   - Human logs in manually in the browser
 *   - Playwright persistent profile auto-saves session
 *   - No credentials are processed by this code
 */

import {
	authenticateWithPersistentBrowser,
	scrapeWithExistingProfile,
	checkAuthStatus,
	getProfileDir,
	getStatusPath,
	getRuntimeDir,
} from "./minimax-browser-auth.js";

async function main() {
	const args = process.argv.slice(2);
	const command = args[0] ?? "auth";

	console.log("");
	console.log("🔐 MiniMax Browser Authentication");
	console.log("=".repeat(50));
	console.log("");

	if (command === "check") {
		console.log("Command: check");
		console.log("");
		const status = await checkAuthStatus();
		console.log("");
		console.log("Status:");
		console.log(JSON.stringify(status, null, 2));
		console.log("");
		console.log("Profile dir:", getProfileDir());
		console.log("Status file:", getStatusPath());
		return;
	}

	if (command === "scrape" || command === "usage") {
		console.log("Command: scrape (silent - uses saved profile)");
		console.log("");
		const status = await scrapeWithExistingProfile();
		console.log("");
		console.log("Result:");
		console.log(JSON.stringify(status, null, 2));
		return;
	}

	if (command === "auth" || command === "login" || command === "open") {
		console.log("Command: auth (persistent browser mode)");
		console.log("");
		console.log("This will:");
		console.log("1. Launch a Chrome browser with persistent profile");
		console.log("2. Navigate to MiniMax usage page");
		console.log("3. Let you log in (first time only)");
		console.log("4. Auto-save profile for future use");
		console.log("");
		console.log("Profile dir:", getProfileDir());
		console.log("");

		const status = await authenticateWithPersistentBrowser();
		console.log("");
		console.log("Result:");
		console.log(JSON.stringify(status, null, 2));
		return;
	}

	console.log("Usage:");
	console.log(
		"  bun packages/auth/src/run-minimax-auth.ts auth    # Login (first time)",
	);
	console.log(
		"  bun packages/auth/src/run-minimax-auth.ts scrape # Scrape usage",
	);
	console.log(
		"  bun packages/auth/src/run-minimax-auth.ts check  # Check status",
	);
	console.log(
		"  bun packages/auth/src/run-minimax-auth.ts open   # Open browser",
	);
	console.log("");
	console.log("Security:");
	console.log("- Human logs in manually in the browser");
	console.log("- Playwright auto-saves persistent profile");
	console.log("- No credentials are processed by this code");
}

main().catch((error) => {
	console.error("Error:", error.message);
	process.exit(1);
});

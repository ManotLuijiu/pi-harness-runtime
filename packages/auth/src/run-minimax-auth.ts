#!/usr/bin/env bun
/**
 * run-minimax-auth.ts
 *
 * CLI to authenticate with MiniMax using Playwright browser.
 *
 * Usage:
 *   bun packages/auth/src/run-minimax-auth.ts        # Authenticate
 *   bun packages/auth/src/run-minimax-auth.ts check # Check status
 *
 * Security:
 *   - Human logs in manually in the browser
 *   - No credentials are processed by this code
 *   - Only safe status file is written
 */

import {
	authenticateWithBrowser,
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
		// Check current authentication status
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

	if (command === "auth" || command === "login") {
		// Start authentication flow
		console.log("Command: auth");
		console.log("");
		console.log("This will open a browser window.");
		console.log("Please log in to MiniMax manually.");
		console.log("");
		console.log("Directory:", getRuntimeDir());
		console.log("");

		const status = await authenticateWithBrowser();
		console.log("");
		console.log("Result:");
		console.log(JSON.stringify(status, null, 2));
		return;
	}

	// Help
	console.log("Usage:");
	console.log("  bun packages/auth/src/run-minimax-auth.ts        # Authenticate");
	console.log("  bun packages/auth/src/run-minimax-auth.ts auth  # Same as above");
	console.log("  bun packages/auth/src/run-minimax-auth.ts check # Check status");
	console.log("");
	console.log("Security:");
	console.log("- Human logs in manually in the browser");
	console.log("- No credentials are processed by this code");
	console.log("- Only safe status file is written");
}

main().catch((error) => {
	console.error("Error:", error.message);
	process.exit(1);
});

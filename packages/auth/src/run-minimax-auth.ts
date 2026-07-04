#!/usr/bin/env bun
/**
 * run-minimax-auth.ts
 *
 * CLI to authenticate with MiniMax using Playwright browser with curator mode.
 *
 * Usage:
 *   bun packages/auth/src/run-minimax-auth.ts        # Authenticate (curator mode)
 *   bun packages/auth/src/run-minimax-auth.ts check   # Check status
 *
 * Security:
 *   - Human logs in manually in the browser
 *   - No credentials are processed by this code
 *   - Only safe status file is written
 */

import {
	authenticateWithCurator,
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

	if (command === "auth" || command === "login") {
		console.log("Command: auth (curator mode)");
		console.log("");
		console.log("This will:");
		console.log("1. Launch a Chrome browser with debugging port");
		console.log("2. Start a local HTTP server");
		console.log("3. Give you a URL to open in your browser");
		console.log("4. Let you log in to MiniMax");
		console.log("");
		console.log("Directory:", getRuntimeDir());
		console.log("");

		const status = await authenticateWithCurator();
		console.log("");
		console.log("Result:");
		console.log(JSON.stringify(status, null, 2));
		return;
	}

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

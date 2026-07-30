/**
 * Gist Auth Setup
 *
 * Usage:
 *   bun run gist-auth
 *
 * Prompts for GitHub PAT and creates a secret Gist for clipboard sync.
 */

import { readline } from "bun";
import {
	createGist,
	isConfigured,
} from "../packages/clipboard/src/gist-relay.ts";

async function main() {
	console.log("\n=== pi-harness-runtime Gist Clipboard Sync Setup ===\n");

	if (isConfigured()) {
		console.log("Gist clipboard sync is already configured.");
		console.log("Run with --reset to reconfigure.\n");
		const rl = new readline.Interface({ input: stdin, output: stdout });
		const answer = await rl.question("Reset configuration? (y/N): ");
		rl.close();
		if (answer.toLowerCase() !== "y") {
			console.log("Aborted.\n");
			return;
		}
	}

	console.log("To enable clipboard sync to GitHub Gist:\n");
	console.log("1. Go to https://github.com/settings/tokens");
	console.log("2. Click 'Generate new token (classic)'");
	console.log("3. Select scopes: 'gist' (read and write gists)");
	console.log("4. Copy the token\n");

	const rl = new readline.Interface({ input: stdin, output: stdout });
	const token = await rl.question("GitHub Personal Access Token: ");
	rl.close();

	if (!token.trim()) {
		console.log("No token provided. Aborted.\n");
		return;
	}

	console.log("\nCreating secret Gist...\n");

	const testContent = `pi-harness-runtime clipboard sync active
Timestamp: ${new Date().toISOString()}
`;

	const result = await createGist(token.trim(), testContent);

	if (result) {
		console.log("✅ Gist clipboard sync configured!");
		console.log(`   Gist URL: ${result.gistUrl}`);
		console.log("\nClient devices can poll this Gist for clipboard content.");
		console.log("See scripts/gist-poll.sh for client setup.\n");
	} else {
		console.log("❌ Failed to create Gist. Check your token and try again.\n");
	}
}

main().catch(console.error);

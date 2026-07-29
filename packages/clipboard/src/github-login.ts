/**
 * GitHub Login — /github-login slash command
 *
 * Registers the /github-login command that prompts for GitHub PAT
 * and creates a secret Gist for clipboard sync.
 */

import { createGist, isConfigured } from "./gist-relay.js";

/**
 * Register /github-login command in pi-coding-agent
 */
export function registerGithubLoginCommand(pi: {
	registerCommand: (
		name: string,
		options: {
			description: string;
			handler: (args: string, ctx: unknown) => Promise<void>;
		},
	) => void;
}): void {
	pi.registerCommand("github-login", {
		description: "Connect GitHub Gist for clipboard sync across devices",
		handler: async (_args: string, rawCtx: unknown) => {
			const ctx = rawCtx as {
				ui: {
					notify: (msg: string, type?: string) => void;
					input: (
						title: string,
						placeholder?: string,
					) => Promise<string | undefined>;
					confirm: (title: string, msg: string) => Promise<boolean>;
				};
			};
			// Check if already configured
			if (isConfigured()) {
				const reset = await ctx.ui.confirm(
					"GitHub Gist already configured",
					"Reset and reconfigure?",
				);
				if (!reset) {
					ctx.ui.notify("Cancelled.", "info");
					return;
				}
			}

			ctx.ui.notify("Setting up GitHub Gist clipboard sync...", "info");

			// Step 1: Ask user to create PAT
			const instructions = [
				"",
				"Create a GitHub Personal Access Token:",
				"  1. Go to https://github.com/settings/tokens",
				"  2. Generate new token (classic)",
				"  3. Select scope: gist",
				"  4. Copy the token",
				"",
			].join("\n");

			ctx.ui.notify(instructions, "info");

			// Step 2: Prompt for PAT
			const token = await ctx.ui.input(
				"GitHub Personal Access Token",
				"ghp_xxxxxxxxxxxxxxxxxxxx",
			);

			if (!token?.trim()) {
				ctx.ui.notify("No token provided. Cancelled.", "warning");
				return;
			}

			// Step 3: Create Gist
			ctx.ui.notify("Creating secret Gist...", "info");

			const testContent = [
				"pi-harness-runtime clipboard sync",
				`Connected at: ${new Date().toISOString()}`,
				"",
				"This Gist stores clipboard content for cross-device sync.",
				"Polling script: see scripts/gist-poll.sh",
			].join("\n");

			const result = await createGist(token.trim(), testContent);

			if (result) {
				ctx.ui.notify(
					[
						"✅ GitHub Gist clipboard sync configured!",
						"",
						`   Gist: ${result.gistUrl}`,
						"",
						"   Polling script: scripts/gist-poll.sh",
						"   Run: bun scripts/gist-auth-poll.ts on client devices",
						"",
					].join("\n"),
					"info",
				);
			} else {
				ctx.ui.notify(
					"❌ Failed to create Gist. Check your PAT and try again.",
					"error",
				);
			}
		},
	});
}

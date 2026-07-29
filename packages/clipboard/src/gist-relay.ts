/**
 * Gist Relay — GitHub Gist clipboard sync
 *
 * Stores clipboard content in a secret Gist, accessible from any device.
 * - POST: Upload clipboard content to Gist
 * - GET:  Download latest clipboard content from Gist
 *
 * Security: Uses secret Gist (only accessible via API token)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HARNESS_DIR = join(homedir(), ".pi-harness-runtime");
const CONFIG_FILE = join(HARNESS_DIR, "gist-config.json");

interface GistConfig {
	token: string;
	gistId: string;
	gistUrl: string;
}

interface GistFile {
	content: string;
}

interface GistResponse {
	id: string;
	html_url: string;
	files: Record<string, GistFile>;
}

// ─── Config ──────────────────────────────────────────────────────────────

function loadConfig(): GistConfig | null {
	try {
		if (!existsSync(CONFIG_FILE)) return null;
		const raw = readFileSync(CONFIG_FILE, "utf8");
		return JSON.parse(raw) as GistConfig;
	} catch {
		return null;
	}
}

function saveConfig(config: GistConfig): void {
	mkdirSync(HARNESS_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

// ─── API ────────────────────────────────────────────────────────────────

/**
 * Check if Gist relay is configured
 */
export function isConfigured(): boolean {
	return loadConfig() !== null;
}

/**
 * Get stored GitHub token
 */
export function getToken(): string | null {
	return loadConfig()?.token ?? null;
}

/**
 * Store GitHub token and Gist ID after initial setup
 */
export function saveCredentials(
	token: string,
	gistId: string,
	gistUrl: string,
): void {
	saveConfig({ token, gistId, gistUrl });
}

/**
 * Create a new secret Gist and return its ID
 */
export async function createGist(
	token: string,
	content: string,
): Promise<GistConfig | null> {
	try {
		const response = await fetch("https://api.github.com/gists", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({
				description: "pi-harness-runtime clipboard sync",
				public: false,
				files: {
					"clipboard.txt": {
						content: content || "(empty)",
					},
				},
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			console.error(
				`[gist-relay] Failed to create Gist: ${response.status} ${error}`,
			);
			return null;
		}

		const gist = (await response.json()) as GistResponse;
		const config: GistConfig = {
			token,
			gistId: gist.id,
			gistUrl: gist.html_url,
		};
		saveConfig(config);
		return config;
	} catch (err) {
		console.error("[gist-relay] Failed to create Gist:", err);
		return null;
	}
}

/**
 * Update existing Gist with new clipboard content
 */
export async function updateGist(content: string): Promise<boolean> {
	const config = loadConfig();
	if (!config) {
		console.error(
			"[gist-relay] Not configured. Run 'bun run gist-auth' first.",
		);
		return false;
	}

	try {
		const response = await fetch(
			`https://api.github.com/gists/${config.gistId}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${config.token}`,
					"Content-Type": "application/json",
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
				body: JSON.stringify({
					description: "pi-harness-runtime clipboard sync",
					files: {
						"clipboard.txt": {
							content: content,
						},
					},
				}),
			},
		);

		if (!response.ok) {
			const error = await response.text();
			console.error(
				`[gist-relay] Failed to update Gist: ${response.status} ${error}`,
			);
			return false;
		}

		return true;
	} catch (err) {
		console.error("[gist-relay] Failed to update Gist:", err);
		return false;
	}
}

/**
 * Fetch current clipboard content from Gist
 */
export async function fetchFromGist(): Promise<string | null> {
	const config = loadConfig();
	if (!config) {
		return null;
	}

	try {
		const response = await fetch(
			`https://api.github.com/gists/${config.gistId}`,
			{
				headers: {
					Authorization: `Bearer ${config.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
		);

		if (!response.ok) {
			return null;
		}

		const gist = (await response.json()) as GistResponse;
		return gist.files["clipboard.txt"]?.content ?? null;
	} catch {
		return null;
	}
}

/**
 * Post clipboard content to Gist. Creates Gist on first call, updates on subsequent calls.
 */
export async function postToGist(content: string): Promise<boolean> {
	const config = loadConfig();

	if (!config) {
		// First time — need token
		console.error(
			"[gist-relay] Not configured. Run 'bun run gist-auth' first.",
		);
		return false;
	}

	// Update existing Gist
	const ok = await updateGist(content);
	if (ok) {
		console.error(`[gist-relay] Synced ${content.length} chars to Gist`);
	}
	return ok;
}

/**
 * Delete stored Gist config (for reset)
 */
export function clearConfig(): void {
	try {
		const { unlinkSync } = require("node:fs");
		unlinkSync(CONFIG_FILE);
	} catch {
		// ignore
	}
}

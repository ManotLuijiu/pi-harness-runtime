/**
 * Copy + Sync — Ctrl+Shift+C shortcut for clipboard sync
 *
 * Registers a keyboard shortcut that:
 * 1. Reads selected text from clipboard (Xvfb/X11 on headless server)
 * 2. Writes to bridge file for terminal paste
 * 3. POSTs to GitHub Gist for cross-device sync
 *
 * Only fires on explicit Ctrl+Shift+C — NOT on auto-select/highlight.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { postToGist, isConfigured as isGistConfigured } from "./gist-relay.js";

// ─── Bridge file path ─────────────────────────────────────────────────────────

const BRIDGE_FILE = join(homedir(), ".herdr-clipboard");
const XCLIP_WRAPPER = join(homedir(), ".local", "bin", "xclip");

// ─── Read from Xvfb clipboard ─────────────────────────────────────────────────

function readFromClipboard(): string | null {
	// Try Xvfb xclip first (our headless clipboard)
	try {
		const content = execSync(
			`"${XCLIP_WRAPPER}" -selection clipboard -o 2>/dev/null || DISPLAY=:99 xclip -selection clipboard -o 2>/dev/null || true`,
			{ encoding: "utf8", timeout: 2000 },
		).trim();
		if (content) return content;
	} catch {
		// Fall through
	}

	// Fallback: read bridge file directly
	try {
		if (existsSync(BRIDGE_FILE)) {
			return readFileSync(BRIDGE_FILE, "utf8").trim();
		}
	} catch {
		// fall through
	}

	return null;
}

// ─── Write to bridge file ─────────────────────────────────────────────────────

function writeToBridge(text: string): void {
	try {
		writeFileSync(BRIDGE_FILE, text, "utf8");
	} catch {
		// ignore
	}
}

// ─── Write to Xvfb clipboard ──────────────────────────────────────────────────

function writeToXvfb(text: string): boolean {
	try {
		execSync(`"${XCLIP_WRAPPER}" -selection clipboard -in`, {
			input: text,
			encoding: "utf8",
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

// ─── Main: copy + sync ───────────────────────────────────────────────────────

/**
 * Read selected text, write to bridge, sync to Gist.
 * Called by the Ctrl+Shift+C shortcut handler.
 */
export async function copyAndSync(ctx: {
	ui: { notify: (msg: string, type?: string) => void };
}): Promise<void> {
	const text = readFromClipboard();

	if (!text) {
		ctx.ui.notify(
			"No clipboard content. Make sure text is selected in the terminal.",
			"warning",
		);
		return;
	}

	// Write to bridge file (for terminal paste)
	writeToBridge(text);

	// Write to Xvfb clipboard (for Ctrl+Shift+V paste in terminal)
	const xvfbOk = writeToXvfb(text);

	// Sync to GitHub Gist (for cross-device clipboard)
	if (isGistConfigured()) {
		const gistOk = await postToGist(text);
		if (gistOk) {
			ctx.ui.notify(`Synced ${text.length} chars to Gist ✓`, "info");
		} else {
			ctx.ui.notify(
				`Copied ${text.length} chars (Gist sync failed)`,
				"warning",
			);
		}
	} else if (xvfbOk) {
		ctx.ui.notify(`Copied ${text.length} chars to clipboard`, "info");
	} else {
		ctx.ui.notify(
			`Copied ${text.length} chars (terminal paste may not work on headless server)`,
			"warning",
		);
	}
}

// ─── Register shortcut ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPi = any;

/**
 * Register Ctrl+Shift+C as the copy+sync shortcut.
 * The Key.ctrlShift("c") syntax comes from @earendil-works/pi-tui.
 */
export function registerCopySyncShortcut(pi: AnyPi, Key: AnyPi): void {
	try {
		pi.registerShortcut(Key.ctrlShift("c"), {
			description: "Copy to clipboard + sync to GitHub Gist",
			handler: async (rawCtx: AnyPi) => {
				await copyAndSync(
					rawCtx as { ui: { notify: (msg: string, type?: string) => void } },
				);
			},
		});
	} catch (err) {
		console.error("[copy-sync] Failed to register shortcut:", err);
	}
}

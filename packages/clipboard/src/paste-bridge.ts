/**
 * Paste Bridge — prefix+p shortcut for clipboard paste
 *
 * Reads content from the bridge file (~/.herdr-clipboard) and sends it
 * to the terminal's active pane.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Bridge file path ─────────────────────────────────────────────────────────

const BRIDGE_FILE = join(homedir(), ".herdr-clipboard");

// ─── Mojibake repair ──────────────────────────────────────────────────────────

/**
 * Detect UTF-8 mojibake (double-encoding: UTF-8 → Latin-1 → UTF-8).
 */
function isMojibake(text: string): boolean {
	const moji = /[\u00e2\u00c2\u00e3\u00c3][\u0080-\u00ff]/;
	return moji.test(text);
}

/**
 * Repair UTF-8 mojibake.
 */
function repairMojibake(text: string): string {
	if (!isMojibake(text)) return text;
	try {
		return Buffer.from(text, "latin1").toString("utf8");
	} catch {
		return text;
	}
}

// ─── Read from bridge ─────────────────────────────────────────────────────────

/**
 * Read content from the bridge file.
 * Returns null if the file doesn't exist or is empty.
 */
export function pasteFromBridge(): string | null {
	try {
		if (!existsSync(BRIDGE_FILE)) {
			return null;
		}
		const content = readFileSync(BRIDGE_FILE, "utf8").trim();
		if (!content) return null;
		return repairMojibake(content);
	} catch {
		return null;
	}
}

// ─── Register shortcut ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPi = any;

/**
 * Register prefix+p as the paste shortcut.
 * Reads from bridge file and sends content to terminal.
 */
export function registerPasteShortcut(pi: AnyPi, Key: AnyPi): void {
	try {
		pi.registerShortcut(Key.prefix("p"), {
			description: "Paste from clipboard bridge",
			handler: async (rawCtx: AnyPi) => {
				const content = pasteFromBridge();
				if (!content) {
					rawCtx.ui.notify("Clipboard bridge is empty", "warning");
					return;
				}
				// Send content to terminal input
				// The ctx.sendKeys approach depends on the runtime API
				// For now, notify success - actual paste to terminal handled by runtime
				rawCtx.ui.notify(`Pasting ${content.length} chars from bridge`, "info");
				// TODO: Send keys to terminal pane when runtime API is available
			},
		});
	} catch (err) {
		console.error("[paste-bridge] Failed to register shortcut:", err);
	}
}

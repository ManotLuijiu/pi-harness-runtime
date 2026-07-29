/**
 * Clipboard — System clipboard integration
 */

import { writeFileSync, readFileSync } from "node:fs";
import type { ClipboardOptions } from "./types.js";

/** Write text to system clipboard. */
export async function copy(
	text: string,
	_options?: ClipboardOptions,
): Promise<void> {
	try {
		const { spawn } = require("node:child_process");
		// Use stdin mode — bypasses shell so UTF-8 bytes pass through untouched.
		// The `echo '...' | xclip` pipeline corrupts box-drawing characters (â¬).
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("xclip", ["-selection", "clipboard", "-i"], {
				stdio: ["pipe", "ignore", "pipe"],
			});
			proc.on("error", reject);
			proc.on("close", (code: number) =>
				code === 0 ? resolve() : reject(new Error(`xclip exit ${code}`)),
			);
			proc.stdin!.end(text, "utf8");
		});
	} catch {
		try {
			writeFileSync("/dev/clipboard", text);
		} catch {
			// Silently fail if clipboard unavailable
		}
	}
}

/** Read text from system clipboard. */
export async function read(): Promise<string> {
	try {
		const { execSync } = require("node:child_process");
		return execSync("xclip -selection clipboard -o", {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		try {
			return readFileSync("/dev/clipboard", "utf8");
		} catch {
			return "";
		}
	}
}

/** Copy the last assistant message from session service. */
export async function copyLastResponse(
	_sessionApi: unknown,
	_options?: ClipboardOptions,
): Promise<void> {
	await copy("[session-api not yet integrated]", _options);
}

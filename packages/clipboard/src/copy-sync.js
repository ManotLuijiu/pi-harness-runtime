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
// ─── Mojibake detection & repair ──────────────────────────────────────────────
/**
 * Detect UTF-8 mojibake (double-encoding: UTF-8 → Latin-1 → UTF-8).
 *
 * The pattern:
 * - UTF-8 box-drawing chars (e2 xx xx) get Latin-1 decoded to "âÄx" chars
 * - When those Latin-1 chars are re-encoded as UTF-8:
 *   - "â" (c3 a2) = UTF-8 Latin small Letter A with Circumflex
 *   - "Ä" (c2 94) = UTF-8 Latin Capital Letter A with Diaeresis
 *   - "Œ" (c2 8c) = UTF-8 Latin Capital Ligature OE
 * - So raw UTF-8 box-drawing chars e2 94 8c become "âÄŒ" (c3 a2 c2 94 c2 8c)
 *   when misdecoded as Latin-1 then re-encoded.
 *
 * Detection heuristic: "â" or "Ã" followed by another non-ASCII char or
 * box-drawing surrogate pairs.  These sequences are almost always mojibake.
 */
function isMojibake(text) {
    // "â" = \u00e2, "Ã" = \u00c3 — common Latin-1 surrogates in mojibake
    // Check for these appearing before other non-ASCII chars (box-drawing etc.)
    const moji = /[\u00e2\u00c2\u00e3\u00c3][\u0080-\u00ff]/;
    return moji.test(text);
}
/**
 * Repair UTF-8 mojibake: UTF-8 bytes interpreted as Latin-1 → re-interpret as UTF-8.
 *
 * Safe because:
 * 1. isMojibake() already confirmed the string has the characteristic pattern
 * 2. We only apply Buffer.from(str, "latin1") to the affected substrings
 * 3. Plain ASCII and correctly-encoded UTF-8 pass through unchanged
 *    (Buffer.from("hello", "latin1").toString("utf8") === "hello")
 * 4. Thai/other CJK scripts don't have the "â"+"Ä" surrogate pattern
 *
 * @param text - possibly-mojibaked string
 * @returns repaired UTF-8 string
 */
function repairMojibake(text) {
    if (!isMojibake(text))
        return text;
    try {
        // Encode the JavaScript string back to its byte representation using
        // Latin-1 (which is byte-identity for all code points 0-255), then
        // decode those bytes as UTF-8.  This reverses the double-encoding.
        return Buffer.from(text, "latin1").toString("utf8");
    }
    catch {
        // If encoding fails for any reason, return original
        return text;
    }
}
// ─── Read from Xvfb clipboard ─────────────────────────────────────────────────
function readFromClipboard() {
    // Try Xvfb xclip first (our headless clipboard)
    try {
        const content = execSync(`"${XCLIP_WRAPPER}" -selection clipboard -o 2>/dev/null || DISPLAY=:99 xclip -selection clipboard -o 2>/dev/null || true`, { encoding: "utf8", timeout: 2000 })
            .trim()
            // Repair mojibake that xclip or Xvfb might have introduced
            .replace(/\r\n/g, "\n");
        if (content)
            return repairMojibake(content);
    }
    catch {
        // Fall through
    }
    // Fallback: read bridge file directly
    try {
        if (existsSync(BRIDGE_FILE)) {
            const content = readFileSync(BRIDGE_FILE, "utf8").trim();
            if (content)
                return repairMojibake(content);
        }
    }
    catch {
        // fall through
    }
    return null;
}
// ─── Write to bridge file ─────────────────────────────────────────────────────
function writeToBridge(text) {
    try {
        // Write raw UTF-8 bytes — no transformation needed.
        // UTF-8 strings in Node.js write correctly with writeFileSync(file, "utf8").
        writeFileSync(BRIDGE_FILE, text, "utf8");
    }
    catch {
        // ignore
    }
}
// ─── Write to Xvfb clipboard ──────────────────────────────────────────────────
function writeToXvfb(text) {
    try {
        // Pass raw bytes via Buffer to avoid any implicit encoding conversion.
        // This ensures UTF-8 multi-byte sequences are sent as-is to xclip.
        execSync(`"${XCLIP_WRAPPER}" -selection clipboard -in`, {
            input: Buffer.from(text, "utf8"),
            timeout: 5000,
        });
        return true;
    }
    catch {
        return false;
    }
}
// ─── Main: copy + sync ───────────────────────────────────────────────────────
/**
 * Read selected text, write to bridge, sync to Gist.
 * Called by the Ctrl+Shift+C shortcut handler.
 */
export async function copyAndSync(ctx) {
    const text = readFromClipboard();
    if (!text) {
        ctx.ui.notify("No clipboard content. Make sure text is selected in the terminal.", "warning");
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
        }
        else {
            ctx.ui.notify(`Copied ${text.length} chars (Gist sync failed)`, "warning");
        }
    }
    else if (xvfbOk) {
        ctx.ui.notify(`Copied ${text.length} chars to clipboard`, "info");
    }
    else {
        ctx.ui.notify(`Copied ${text.length} chars (terminal paste may not work on headless server)`, "warning");
    }
}
/**
 * Register Ctrl+Shift+C as the copy+sync shortcut.
 * The Key.ctrlShift("c") syntax comes from @earendil-works/pi-tui.
 */
export function registerCopySyncShortcut(pi, Key) {
    try {
        pi.registerShortcut(Key.ctrlShift("c"), {
            description: "Copy to clipboard + sync to GitHub Gist",
            handler: async (rawCtx) => {
                await copyAndSync(rawCtx);
            },
        });
    }
    catch (err) {
        console.error("[copy-sync] Failed to register shortcut:", err);
    }
}

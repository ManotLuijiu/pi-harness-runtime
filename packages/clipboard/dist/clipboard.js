/**
 * Clipboard — System clipboard integration
 */
import { writeFileSync, readFileSync } from "node:fs";
/** Write text to system clipboard. */
export async function copy(text, _options) {
    try {
        // Linux: prefer xclip, fall back to /dev/clipboard
        const { execSync } = require("node:child_process");
        try {
            execSync(`echo '${text.replace(/'/g, "'\"'\"'")}' | xclip -selection clipboard`, { stdio: "ignore" });
        }
        catch {
            writeFileSync("/dev/clipboard", text);
        }
    }
    catch {
        // Silently fail if clipboard unavailable
    }
}
/** Read text from system clipboard. */
export async function read() {
    try {
        const { execSync } = require("node:child_process");
        return execSync("xclip -selection clipboard -o", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        try {
            return readFileSync("/dev/clipboard", "utf8");
        }
        catch {
            return "";
        }
    }
}
/** Copy the last assistant message from session service. */
export async function copyLastResponse(_sessionApi, _options) {
    await copy("[session-api not yet integrated]", _options);
}
//# sourceMappingURL=clipboard.js.map
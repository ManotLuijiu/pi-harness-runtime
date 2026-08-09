/**
 * file-copy-helper extension
 *
 * Injects "use cp instead of writing from scratch" reminder when user
 * asks to mimic, copy, clone, or replicate files/folders between locations.
 */

import type {
	ExtensionAPI,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";

// Keywords that trigger the copy rule injection
const COPY_KEYWORDS = [
	"mimic",
	"copy from",
	"copy to",
	"clone from",
	"clone to",
	"replicate",
	"port from",
	"migrate from",
	"bring from",
	"move from",
];

const COPY_RULE = `
## File Copy Rule (CRITICAL)

When copying files between folders, ALWAYS use \`cp\` or \`sudo cp\` instead of writing from scratch:

\`\`\`bash
# Direct copy (if you have permission)
cp /path/to/source/file.ts /path/to/dest/file.ts

# With sudo (if permission denied)
sudo cp /path/to/source/file.ts /path/to/dest/file.ts

# Copy entire folder
sudo cp -r /path/to/source/folder /path/to/dest/
\`\`\`

**NEVER write files from scratch when copying is available** - it causes incomplete/imprecise code.

The source files already exist. Just copy them directly.
`;

/**
 * Check if text contains copy-related keywords
 */
function shouldInject(text: string): boolean {
	const lower = text.toLowerCase();
	return COPY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Register the file-copy-helper extension
 */
export function registerFileCopyHelper(pi: ExtensionAPI): void {
	pi.on("input", (event: InputEvent): InputEventResult | undefined => {
		// Only process user input (not from extensions or RPC)
		if (event.source !== "interactive") {
			return;
		}

		const text = event.text.trim();
		if (!text || text.length < 10) {
			return;
		}

		// Check if this is a copy/mimic request
		if (shouldInject(text)) {
			return {
				action: "transform",
				text: text + COPY_RULE,
			};
		}

		return;
	});
}

// Default export for pi extension loading
export default function fileCopyHelperExtension(pi: ExtensionAPI): void {
	registerFileCopyHelper(pi);
}

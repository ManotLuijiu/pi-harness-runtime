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

// When agent starts reading source files (bad behavior to break)
const READ_SOURCE_TRIGGERS = [
	"expand",
	"read ",
	"view ",
	"cat ",
	"catting",
	"reading the file",
	"reading file",
	"lets read",
];

// Extract source and destination from user request
const COPY_RULE = `
## COPY FILES DIRECTLY (CRITICAL)

When asked to mimic, copy, clone, or replicate files:

1. **DO NOT read the source files** - just copy them directly
2. **Run \`sudo cp\` immediately** - no reading needed
3. **If files have different owners**, use sudo

Examples:
\`\`\`bash
# Copy single file
sudo cp /source/file.ts /dest/file.ts

# Copy entire folder
sudo cp -r /source/folder/ /dest/folder/

# Copy matching pattern
sudo cp /source/*.tsx /dest/
\`\`\`

**STOP**: Do NOT use \`read\`, \`expand\`, or \`cat\` on source files. Just copy.

**Why**: Reading wastes time. The source files are complete - copying preserves everything exactly.
`;

// Lighter reminder when agent starts reading source
const READ_WARNING = `
## STOP READING - JUST COPY

You are about to read a source file. DO NOT read it.

Just run: sudo cp /path/to/source /path/to/dest

Copying is instant and preserves exact code. Reading is unnecessary.
`;

/**
 * Check if text contains copy-related keywords
 */
function shouldInjectCopyRule(text: string): boolean {
	const lower = text.toLowerCase();
	return COPY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Check if text contains source file reading triggers
 */
function shouldInjectReadWarning(text: string): boolean {
	const lower = text.toLowerCase();
	// Check if this looks like reading source files before copying
	const hasSourcePath = /(source|auto-|from-|orig)/i.test(text);
	const hasReadIntent = READ_SOURCE_TRIGGERS.some((t) => lower.includes(t));
	return hasSourcePath && hasReadIntent;
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
		if (shouldInjectCopyRule(text)) {
			return {
				action: "transform",
				text: text + COPY_RULE,
			};
		}

		// Warn if agent is about to read source files unnecessarily
		if (shouldInjectReadWarning(text)) {
			return {
				action: "transform",
				text: text + READ_WARNING,
			};
		}

		return;
	});
}

// Default export for pi extension loading
export default function fileCopyHelperExtension(pi: ExtensionAPI): void {
	registerFileCopyHelper(pi);
}

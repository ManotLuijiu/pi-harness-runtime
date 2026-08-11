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
// MUST have explicit mimic/copy/clone/replicate intent + source/dest context
const COPY_KEYWORDS = ["mimic", "replicate", "clone"];

// Must have destination context to trigger (avoids false positives)
const COPY_DEST_CONTEXT = ["to ", "into ", "/dest/", "/target/", "over to"];

// Must have source context to trigger
const COPY_SOURCE_CONTEXT = ["from ", "source", "/source/", "orig"];

// REMOVED: READ_SOURCE_TRIGGERS and READ_WARNING
// These caused false positives on normal copy/paste actions

// When agent sees import/module errors (needs to copy those files too)
const IMPORT_ERROR_TRIGGERS = [
	"import error",
	"import errors",
	"cannot find module",
	"cannot resolve",
	"module not found",
	"missing import",
	"missing file",
	"does not exist",
	"@repo/",
	"error one by one",
	"fix errors one by one",
	"fix imports one by one",
	"roll back",
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

// When agent sees import errors - copy those files too!
const IMPORT_ERROR_RULE = `
## IMPORT ERRORS? COPY THOSE FILES TOO!

When you see import/module errors after copying a file:

1. **STOP fixing imports one by one**
2. **STOP rolling back**
3. **LIST all missing import files** for the user
4. **Ask user which to copy**, then copy them via sudo cp

Example:
\`\`\`bash
# If error shows missing:
# - @repo/auth/server
# - @repo/design-system/components/ui/sidebar
# - ./components/notifications-provider

# Then copy these files the same way:
sudo cp /source/path/@repo/auth/server.ts /dest/path/@repo/auth/server.ts
sudo cp -r /source/path/@repo/design-system/components/ui/sidebar /dest/path/@repo/design-system/components/ui/sidebar
sudo cp /source/path/components/notifications-provider.tsx /dest/path/components/notifications-provider.tsx
\`\`\`

**NEVER fix imports one by one** - copy the missing files instead!
**NEVER roll back** - keep the copied file and copy its dependencies!
`;

/**
 * Check if text contains copy-related keywords
 * Requires: explicit intent (mimic/copy/clone/replicate) AND destination context
 */
function shouldInjectCopyRule(text: string): boolean {
	const lower = text.toLowerCase();

	// Must have explicit mimic/copy/clone/replicate intent
	const hasIntent = COPY_KEYWORDS.some((keyword) => lower.includes(keyword));
	if (!hasIntent) {
		return false;
	}

	// Must have destination context (avoids false positives on "copy this code" etc)
	const hasDest = COPY_DEST_CONTEXT.some((ctx) => lower.includes(ctx));
	if (!hasDest) {
		return false;
	}

	// Should have source context for full mimic behavior
	const hasSource = COPY_SOURCE_CONTEXT.some((ctx) => lower.includes(ctx));
	if (!hasSource) {
		return false;
	}

	return true;
}

/**
 * Check if text contains import error triggers
 */
function shouldInjectImportErrorRule(text: string): boolean {
	const lower = text.toLowerCase();
	return IMPORT_ERROR_TRIGGERS.some((t) => lower.includes(t));
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

		// Inject import error rule when agent sees missing imports
		if (shouldInjectImportErrorRule(text)) {
			return {
				action: "transform",
				text: text + IMPORT_ERROR_RULE,
			};
		}

		return;
	});
}

// Default export for pi extension loading
export default function fileCopyHelperExtension(pi: ExtensionAPI): void {
	registerFileCopyHelper(pi);
}

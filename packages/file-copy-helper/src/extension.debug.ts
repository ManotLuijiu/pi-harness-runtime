/**
 * file-copy-helper extension (DEBUG VERSION)
 *
 * Injects "use cp instead of writing from scratch" reminder when user
 * asks to mimic, copy, clone, or replicate files/folders between locations.
 *
 * DEBUG: All events and rule evaluations logged to /tmp/file-copy-helper-debug.log
 */

import type {
	ExtensionAPI,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import * as fs from "fs";

// DEBUG: Write to file instead of TUI
const DEBUG_LOG = "/tmp/file-copy-helper-debug.log";

function debugLog(label: string, data: unknown): void {
	const timestamp = new Date().toISOString();
	const entry = `[${timestamp}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
	fs.appendFileSync(DEBUG_LOG, entry);
}

// Keywords that trigger the copy rule injection
// MUST have explicit mimic/copy/clone/replicate intent + source/dest context
const COPY_KEYWORDS = ["mimic", "replicate", "clone"];

// Must have destination context to trigger (avoids false positives)
const COPY_DEST_CONTEXT = ["to ", "into ", "/dest/", "/target/", "over to"];

// Must have source context to trigger
const COPY_SOURCE_CONTEXT = ["from ", "source", "/source/", "orig"];

// When agent sees import/module errors (needs to copy those files too)
// MUST have: import/module error context + copy/deploy context
const IMPORT_ERROR_TRIGGERS = [
	// Import error indicators (must have these)
	"cannot find module",
	"cannot resolve module",
	"module not found",
	"missing import",
];

// Copy/deploy context indicators (must have at least one)
const COPY_CONTEXT = [
	"sudo cp",
	"copy.*to",
	"deploy",
	"sync",
	"after copying",
	"after deploy",
	"after sync",
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
function shouldInjectCopyRule(text: string): {
	triggered: boolean;
	reason: string;
} {
	const lower = text.toLowerCase();

	// Must have explicit mimic/copy/clone/replicate intent
	const hasIntent = COPY_KEYWORDS.some((keyword) => lower.includes(keyword));
	if (!hasIntent) {
		return {
			triggered: false,
			reason: `No intent keyword found. Keywords: ${COPY_KEYWORDS.join(", ")}`,
		};
	}

	// Must have destination context (avoids false positives on "copy this code" etc)
	const hasDest = COPY_DEST_CONTEXT.some((ctx) => lower.includes(ctx));
	if (!hasDest) {
		return {
			triggered: false,
			reason: `No destination context found. Dest contexts: ${COPY_DEST_CONTEXT.join(", ")}`,
		};
	}

	// Should have source context for full mimic behavior
	const hasSource = COPY_SOURCE_CONTEXT.some((ctx) => lower.includes(ctx));
	if (!hasSource) {
		return {
			triggered: false,
			reason: `No source context found. Source contexts: ${COPY_SOURCE_CONTEXT.join(", ")}`,
		};
	}

	return {
		triggered: true,
		reason: `All conditions met: hasIntent=${hasIntent}, hasDest=${hasDest}, hasSource=${hasSource}`,
	};
}

/**
 * Check if text contains import error triggers
 */
function shouldInjectImportErrorRule(text: string): {
	triggered: boolean;
	reason: string;
} {
	const lower = text.toLowerCase();
	const matchingTriggers = IMPORT_ERROR_TRIGGERS.filter((t) =>
		lower.includes(t),
	);

	if (matchingTriggers.length === 0) {
		return { triggered: false, reason: "No import error triggers found" };
	}

	return {
		triggered: true,
		reason: `Matched triggers: ${matchingTriggers.join(", ")}`,
	};
}

/**
 * Register the file-copy-helper extension
 */
export function registerFileCopyHelper(pi: ExtensionAPI): void {
	// Clear debug log on startup
	fs.writeFileSync(
		DEBUG_LOG,
		`[${new Date().toISOString()}] === DEBUG SESSION STARTED ===\n`,
	);

	pi.on("input", (event: InputEvent): InputEventResult | undefined => {
		// DEBUG: Log what we receive
		debugLog("INPUT_EVENT", {
			source: event.source,
			textLength: event.text?.length,
			textPreview: event.text?.substring(0, 200),
			fullText: event.text,
		});

		// Only process user input (not from extensions or RPC)
		if (event.source !== "interactive") {
			debugLog("SKIP", "not interactive input - skipping");
			return;
		}

		const text = event.text.trim();
		debugLog("PROCESSING_TEXT", {
			text,
			length: text.length,
			hasMinLength: text.length >= 10,
		});

		if (!text || text.length < 10) {
			debugLog("SKIP", "text too short (< 10 chars)");
			return;
		}

		// Check if this is a copy/mimic request
		const copyCheck = shouldInjectCopyRule(text);
		debugLog("COPY_RULE_CHECK", {
			triggered: copyCheck.triggered,
			reason: copyCheck.reason,
			matchingKeywords: COPY_KEYWORDS.filter((k) =>
				text.toLowerCase().includes(k),
			),
			matchingDest: COPY_DEST_CONTEXT.filter((ctx) =>
				text.toLowerCase().includes(ctx),
			),
			matchingSource: COPY_SOURCE_CONTEXT.filter((ctx) =>
				text.toLowerCase().includes(ctx),
			),
		});

		if (copyCheck.triggered) {
			debugLog("INJECT", { rule: "COPY_RULE", reason: copyCheck.reason });
			return {
				action: "transform",
				text: text + COPY_RULE,
			};
		}

		// Inject import error rule when agent sees missing imports
		const importCheck = shouldInjectImportErrorRule(text);
		debugLog("IMPORT_ERROR_CHECK", {
			triggered: importCheck.triggered,
			reason: importCheck.reason,
			matchingTriggers: IMPORT_ERROR_TRIGGERS.filter((t) =>
				text.toLowerCase().includes(t),
			),
		});

		if (importCheck.triggered) {
			debugLog("INJECT", {
				rule: "IMPORT_ERROR_RULE",
				reason: importCheck.reason,
			});
			return {
				action: "transform",
				text: text + IMPORT_ERROR_RULE,
			};
		}

		debugLog("NO_INJECTION", "no rule matched - passing through");
		return;
	});
}

// Default export for pi extension loading
export default function fileCopyHelperExtension(pi: ExtensionAPI): void {
	registerFileCopyHelper(pi);
}

// src/extension.ts
import * as fs from "fs";
var DEBUG_LOG = "/tmp/file-copy-helper-debug.log";
function debugLog(label, data) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${label}: ${JSON.stringify(data, null, 2)}
`;
  fs.appendFileSync(DEBUG_LOG, entry);
}
var COPY_KEYWORDS = ["mimic", "replicate", "clone"];
var COPY_DEST_CONTEXT = ["to ", "into ", "/dest/", "/target/", "over to"];
var COPY_SOURCE_CONTEXT = ["from ", "source", "/source/", "orig"];
var IMPORT_ERROR_TRIGGERS = [
  "cannot find module",
  "cannot resolve module",
  "module not found",
  "missing import"
];
var COPY_CONTEXT = [
  "sudo cp",
  " cp ",
  " cp\t",
  "\bcps+-r",
  "\bmimic\b",
  "\bclone\b",
  "\breplicate\b",
  "\bdeploy\b"
];
var COPY_RULE = `
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
var IMPORT_ERROR_RULE = `
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
function shouldInjectCopyRule(text) {
  const lower = text.toLowerCase();
  const hasIntent = COPY_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (!hasIntent) {
    return {
      triggered: false,
      reason: `No intent keyword found. Keywords: ${COPY_KEYWORDS.join(", ")}`
    };
  }
  const hasDest = COPY_DEST_CONTEXT.some((ctx) => lower.includes(ctx));
  if (!hasDest) {
    return {
      triggered: false,
      reason: `No destination context found. Dest contexts: ${COPY_DEST_CONTEXT.join(", ")}`
    };
  }
  const hasSource = COPY_SOURCE_CONTEXT.some((ctx) => lower.includes(ctx));
  if (!hasSource) {
    return {
      triggered: false,
      reason: `No source context found. Source contexts: ${COPY_SOURCE_CONTEXT.join(", ")}`
    };
  }
  return {
    triggered: true,
    reason: `All conditions met: hasIntent=${hasIntent}, hasDest=${hasDest}, hasSource=${hasSource}`
  };
}
function shouldInjectImportErrorRule(text) {
  const lower = text.toLowerCase();
  const hasImportError = IMPORT_ERROR_TRIGGERS.some((t) => lower.includes(t));
  if (!hasImportError) {
    return { triggered: false, reason: "No import error triggers found" };
  }
  const hasCopyContext = COPY_CONTEXT.some((ctx) => lower.includes(ctx));
  if (!hasCopyContext) {
    return { triggered: false, reason: "No copy/deploy intent found" };
  }
  return { triggered: true, reason: "Has import error + copy intent" };
}
function registerFileCopyHelper(pi) {
  fs.writeFileSync(DEBUG_LOG, `[${new Date().toISOString()}] === DEBUG SESSION STARTED ===
`);
  pi.on("input", (event) => {
    debugLog("INPUT_EVENT", {
      source: event.source,
      textLength: event.text?.length,
      textPreview: event.text?.substring(0, 200),
      fullText: event.text
    });
    if (event.source !== "interactive") {
      debugLog("SKIP", "not interactive input - skipping");
      return;
    }
    const text = event.text.trim();
    debugLog("PROCESSING_TEXT", {
      text,
      length: text.length,
      hasMinLength: text.length >= 10
    });
    if (!text || text.length < 10) {
      debugLog("SKIP", "text too short (< 10 chars)");
      return;
    }
    const copyCheck = shouldInjectCopyRule(text);
    debugLog("COPY_RULE_CHECK", {
      triggered: copyCheck.triggered,
      reason: copyCheck.reason,
      matchingKeywords: COPY_KEYWORDS.filter((k) => text.toLowerCase().includes(k)),
      matchingDest: COPY_DEST_CONTEXT.filter((ctx) => text.toLowerCase().includes(ctx)),
      matchingSource: COPY_SOURCE_CONTEXT.filter((ctx) => text.toLowerCase().includes(ctx))
    });
    if (copyCheck.triggered) {
      debugLog("INJECT", { rule: "COPY_RULE", reason: copyCheck.reason });
      return {
        action: "transform",
        text: text + COPY_RULE
      };
    }
    const importCheck = shouldInjectImportErrorRule(text);
    debugLog("IMPORT_ERROR_CHECK", {
      triggered: importCheck.triggered,
      reason: importCheck.reason,
      hasImportError: IMPORT_ERROR_TRIGGERS.some((t) => text.toLowerCase().includes(t)),
      hasCopyContext: COPY_CONTEXT.some((ctx) => text.toLowerCase().includes(ctx))
    });
    if (importCheck.triggered) {
      debugLog("INJECT", {
        rule: "IMPORT_ERROR_RULE",
        reason: importCheck.reason
      });
      return {
        action: "transform",
        text: text + IMPORT_ERROR_RULE
      };
    }
    debugLog("NO_INJECTION", "no rule matched - passing through");
    return;
  });
}
function fileCopyHelperExtension(pi) {
  registerFileCopyHelper(pi);
}
export {
  registerFileCopyHelper,
  fileCopyHelperExtension as default
};

/**
 * file-copy-helper extension (DEBUG VERSION)
 *
 * Injects "use cp instead of writing from scratch" reminder when user
 * asks to mimic, copy, clone, or replicate files/folders between locations.
 *
 * DEBUG: All events and rule evaluations logged to /tmp/file-copy-helper-debug.log
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Register the file-copy-helper extension
 */
export declare function registerFileCopyHelper(pi: ExtensionAPI): void;
export default function fileCopyHelperExtension(pi: ExtensionAPI): void;
//# sourceMappingURL=extension.debug.d.ts.map
/**
 * Clipboard — System clipboard integration
 */
import type { ClipboardOptions } from "./types.js";
/** Write text to system clipboard. */
export declare function copy(text: string, _options?: ClipboardOptions): Promise<void>;
/** Read text from system clipboard. */
export declare function read(): Promise<string>;
/** Copy the last assistant message from session service. */
export declare function copyLastResponse(_sessionApi: unknown, _options?: ClipboardOptions): Promise<void>;
//# sourceMappingURL=clipboard.d.ts.map
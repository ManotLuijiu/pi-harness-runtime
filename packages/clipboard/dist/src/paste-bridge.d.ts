/**
 * Paste Bridge — prefix+p shortcut for clipboard paste
 *
 * Reads content from the bridge file (~/.herdr-clipboard) and sends it
 * to the terminal's active pane.
 */
/**
 * Read content from the bridge file.
 * Returns null if the file doesn't exist or is empty.
 */
export declare function pasteFromBridge(): string | null;
type AnyPi = any;
/**
 * Register prefix+p as the paste shortcut.
 * Reads from bridge file and sends content to terminal.
 */
export declare function registerPasteShortcut(pi: AnyPi, Key: AnyPi): void;
export {};
//# sourceMappingURL=paste-bridge.d.ts.map
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
/**
 * Read selected text, write to bridge, sync to Gist.
 * Called by the Ctrl+Shift+C shortcut handler.
 */
export declare function copyAndSync(ctx: {
    ui: {
        notify: (msg: string, type?: string) => void;
    };
}): Promise<void>;
type AnyPi = any;
/**
 * Register Ctrl+Shift+C as the copy+sync shortcut.
 * The Key.ctrlShift("c") syntax comes from @earendil-works/pi-tui.
 */
export declare function registerCopySyncShortcut(pi: AnyPi, Key: AnyPi): void;
export {};
//# sourceMappingURL=copy-sync.d.ts.map
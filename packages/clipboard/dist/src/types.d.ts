/**
 * Clipboard — Types
 */
export interface ClipboardContent {
    text: string;
    html?: string;
    source?: string;
}
export interface ClipboardOptions {
    notify?: boolean;
    format?: "text" | "html";
}
//# sourceMappingURL=types.d.ts.map
/**
 * File system tools for the coder agent — read and write files on disk.
 *
 * These tools let the MiniMax coder edit the actual repository instead of
 * just outputting code blocks. Tools are plain Node.js fs wrappers; the
 * agent receives structured JSON results it can act on.
 *
 * Wiki: wiki/multi-agent-langchain.md §file-tools
 */
import { z } from "zod";
/**
 * Read the contents of a file.
 *
 * Use this before editing to see the current code.
 * Returns the full file contents as a string.
 */
export declare const readFile: import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
    encoding: z.ZodOptional<z.ZodEnum<{
        ascii: "ascii";
        base64: "base64";
        "utf-16": "utf-16";
        "utf-8": "utf-8";
    }>>;
}, z.core.$strip>, {
    path: string;
    encoding?: "ascii" | "base64" | "utf-16" | "utf-8" | undefined;
}, {
    path: string;
    encoding?: "ascii" | "base64" | "utf-16" | "utf-8" | undefined;
}, string, unknown, "read_file">;
/**
 * Write or overwrite a file on disk.
 *
 * Creates parent directories if they don't exist.
 * The caller (an agent) is responsible for ensuring the content is correct.
 */
export declare const writeFile: import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    append: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, {
    path: string;
    content: string;
    append?: boolean | undefined;
}, {
    path: string;
    content: string;
    append?: boolean | undefined;
}, string, unknown, "write_file">;
/**
 * List files in a directory (non-recursive).
 *
 * Useful for discovering the project structure.
 */
export declare const listDir: import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>, {
    path: string;
}, {
    path: string;
}, string, unknown, "list_directory">;
/** All file system tools, ready to pass to `createCoderAgent`. */
export declare const fileTools: (import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
    encoding: z.ZodOptional<z.ZodEnum<{
        ascii: "ascii";
        base64: "base64";
        "utf-16": "utf-16";
        "utf-8": "utf-8";
    }>>;
}, z.core.$strip>, {
    path: string;
    encoding?: "ascii" | "base64" | "utf-16" | "utf-8" | undefined;
}, {
    path: string;
    encoding?: "ascii" | "base64" | "utf-16" | "utf-8" | undefined;
}, string, unknown, "read_file"> | import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    append: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, {
    path: string;
    content: string;
    append?: boolean | undefined;
}, {
    path: string;
    content: string;
    append?: boolean | undefined;
}, string, unknown, "write_file"> | import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>, {
    path: string;
}, {
    path: string;
}, string, unknown, "list_directory">)[];
//# sourceMappingURL=file-tools.d.ts.map
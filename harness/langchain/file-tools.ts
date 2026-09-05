/**
 * File system tools for the coder agent — read and write files on disk.
 *
 * These tools let the MiniMax coder edit the actual repository instead of
 * just outputting code blocks. Tools are plain Node.js fs wrappers; the
 * agent receives structured JSON results it can act on.
 *
 * Wiki: wiki/multi-agent-langchain.md §file-tools
 */

import { tool } from "langchain";
import { z } from "zod";
import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
	statSync,
} from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a path relative to repoRoot or as absolute. */
function resolvePath(path: string, repoRoot: string): string {
	if (isAbsolute(path)) return path;
	return resolve(repoRoot, path);
}

// ─── Tools ──────────────────────────────────────────────────────────────────

/**
 * Read the contents of a file.
 *
 * Use this before editing to see the current code.
 * Returns the full file contents as a string.
 */
export const readFile = tool(
	async ({
		path,
		encoding = "utf-8",
	}: {
		/** Absolute path or path relative to the repository root */
		path: string;
		/** File encoding (default: utf-8) */
		encoding?: string;
	}) => {
		try {
			const resolved = resolvePath(path, process.cwd());
			if (!existsSync(resolved)) {
				return JSON.stringify({ error: `File not found: ${resolved}` });
			}
			const stats = statSync(resolved);
			if (stats.isDirectory()) {
				return JSON.stringify({
					error: `Path is a directory, not a file: ${resolved}`,
				});
			}
			const content = readFileSync(resolved, encoding as BufferEncoding);
			return JSON.stringify({
				path: resolved,
				size: stats.size,
				lines: content.split("\n").length,
				content,
			});
		} catch (err) {
			return JSON.stringify({
				error: `Failed to read file: ${path}`,
				detail: err instanceof Error ? err.message : String(err),
			});
		}
	},
	{
		name: "read_file",
		description:
			"Read the full contents of a file from disk. " +
			"Returns the file content as a string. " +
			"Use this before editing a file so you know its current contents. " +
			"Returns JSON with path, size, lines, and content fields.",
		schema: z.object({
			path: z
				.string()
				.describe("Absolute path or path relative to the repository root"),
			encoding: z
				.enum(["utf-8", "utf-16", "ascii", "base64"])
				.optional()
				.describe("File encoding (default: utf-8)"),
		}),
	},
);

/**
 * Write or overwrite a file on disk.
 *
 * Creates parent directories if they don't exist.
 * The caller (an agent) is responsible for ensuring the content is correct.
 */
export const writeFile = tool(
	async ({
		path,
		content,
		append = false,
	}: {
		/** Absolute path or path relative to the repository root */
		path: string;
		/** The content to write. Use \\n for newlines. */
		content: string;
		/** If true, append to the file instead of overwriting (default: false) */
		append?: boolean;
	}) => {
		try {
			const resolved = resolvePath(path, process.cwd());
			// P1-4: create parent directories before writing (fixes ENOENT on nested paths)
			mkdirSync(dirname(resolved), { recursive: true });
			const mode = append ? "a" : "w";
			// P1-4: stop corrupting literal \\n sequences in code files
			const normalized = content; // drop the replace(); agents use actual \n in strings
			writeFileSync(resolved, normalized, { encoding: "utf-8", flag: mode });
			const stats = statSync(resolved);
			return JSON.stringify({
				ok: true,
				path: resolved,
				size: stats.size,
				action: append ? "appended" : "written",
			});
		} catch (err) {
			return JSON.stringify({
				error: `Failed to write file: ${path}`,
				detail: err instanceof Error ? err.message : String(err),
			});
		}
	},
	{
		name: "write_file",
		description:
			"Write or overwrite a file on disk. Creates parent directories automatically. " +
			"Use actual newline characters in the content string. " +
			"Set append=true to add to the end of an existing file. " +
			"Returns JSON with ok, path, size, and action fields.",
		schema: z.object({
			path: z
				.string()
				.describe("Absolute path or path relative to the repository root"),
			content: z.string().describe("File content. Use \\n for newlines."),
			append: z
				.boolean()
				.optional()
				.describe(
					"Append to existing file instead of overwriting (default: false)",
				),
		}),
	},
);

/**
 * List files in a directory (non-recursive).
 *
 * Useful for discovering the project structure.
 */
export const listDir = tool(
	async ({ path }: { path: string }) => {
		try {
			const { readdirSync } = await import("node:fs");
			const resolved = resolvePath(path, process.cwd());
			if (!existsSync(resolved)) {
				return JSON.stringify({ error: `Directory not found: ${resolved}` });
			}
			const entries = readdirSync(resolved, { withFileTypes: true });
			const files = entries.map((e) => ({
				name: e.name,
				type: e.isDirectory() ? "dir" : "file",
				path: join(resolved, e.name),
			}));
			return JSON.stringify({ path: resolved, entries: files });
		} catch (err) {
			return JSON.stringify({
				error: `Failed to list directory: ${path}`,
				detail: err instanceof Error ? err.message : String(err),
			});
		}
	},
	{
		name: "list_directory",
		description:
			"List the contents of a directory (files and subdirectories, non-recursive). " +
			"Returns JSON with path and entries array (each entry has name, type, path).",
		schema: z.object({
			path: z
				.string()
				.describe("Absolute path or path relative to the repository root"),
		}),
	},
);

/** All file system tools, ready to pass to `createCoderAgent`. */
export const fileTools = [readFile, writeFile, listDir];

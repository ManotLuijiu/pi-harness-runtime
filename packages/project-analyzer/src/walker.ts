/**
 * Bounded Filesystem Walker
 *
 * Provides safe, bounded filesystem traversal for project analysis.
 * Implements security boundaries to prevent traversal outside repository.
 */

import { readdir, stat, readFile, readlink } from "node:fs/promises";
import { join, relative, isAbsolute, resolve } from "node:path";
import { type AnalyzerConfig, DEFAULT_ANALYZER_CONFIG } from "./types.js";

/**
 * Scanned file record.
 */
export interface ScannedFile {
	/** Absolute path to file */
	path: string;
	/** Relative path from repository root */
	relativePath: string;
	/** File size in bytes */
	size: number;
	/** Whether file matches a sensitive pattern */
	sensitive: boolean;
	/** Whether file matches a generated pattern */
	generated: boolean;
}

/**
 * Filesystem scan result.
 */
export interface ScanResult {
	/** All scanned files */
	files: ScannedFile[];
	/** Directories scanned */
	directoriesScanned: number;
	/** Files skipped due to limits */
	filesSkipped: number;
	/** Whether scan was truncated */
	truncated: boolean;
	/** Error messages if any */
	errors: string[];
}

/**
 * Match a path against a glob pattern.
 */
function matchesPattern(path: string, pattern: string): boolean {
	// Handle simple glob patterns
	if (pattern === "**") return true;

	// Handle trailing /** for directory patterns
	if (pattern.endsWith("/**")) {
		const dirPattern = pattern.slice(0, -3);
		if (path.startsWith(dirPattern + "/")) return true;
		if (path === dirPattern) return true;
		return false;
	}

	// Handle exact match
	if (!pattern.includes("*")) {
		return path === pattern || path.endsWith("/" + pattern);
	}

	// Handle wildcard in pattern
	const parts = pattern.split("*");
	if (parts.length === 2) {
		const [prefix, suffix] = parts;
		if (prefix && !path.startsWith(prefix)) return false;
		if (suffix && !path.endsWith(suffix)) return false;
		return true;
	}

	return false;
}

/**
 * Check if a path matches any of the given patterns.
 */
function matchesAnyPattern(path: string, patterns: string[]): boolean {
	return patterns.some((p) => matchesPattern(path, p));
}

/**
 * Bounded filesystem walker for project analysis.
 */
export class FileSystemWalker {
	private config: AnalyzerConfig;
	private root: string;
	private filesScanned = 0;
	private dirsScanned = 0;
	private skippedFiles = 0;
	private errors: string[] = [];
	private visitedDirs = new Set<string>();

	constructor(root: string, config?: Partial<AnalyzerConfig>) {
		if (!isAbsolute(root)) {
			throw new Error("Repository root must be an absolute path");
		}
		this.root = resolve(root);
		this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
	}

	/**
	 * Get canonical path and verify it's within repository root.
	 */
	resolvePath(path: string): string {
		const resolved = resolve(this.root, path);
		if (!resolved.startsWith(this.root)) {
			throw new Error(`Path escape attempt detected: ${path}`);
		}
		return resolved;
	}

	/**
	 * Check if a path should be skipped based on patterns.
	 */
	private isSensitive(path: string): boolean {
		return matchesAnyPattern(path, this.config.sensitivePatterns);
	}

	/**
	 * Check if a path is a generated file/directory.
	 */
	private isGenerated(path: string): boolean {
		return matchesAnyPattern(path, this.config.generatedPatterns);
	}

	/**
	 * Get relative path from repository root.
	 */
	private getRelativePath(absPath: string): string {
		return relative(this.root, absPath);
	}

	/**
	 * Recursively scan directory with depth limiting.
	 */
	private async scanDir(
		dirPath: string,
		depth: number,
	): Promise<ScannedFile[]> {
		if (depth > this.config.maxDepth) {
			return [];
		}

		const relativePath = this.getRelativePath(dirPath);
		const resolvedPath = this.resolvePath(dirPath);

		// Prevent infinite loops from circular symlinks
		try {
			const realPath = (await stat(resolvedPath)).ino?.toString();
			if (realPath && this.visitedDirs.has(realPath)) {
				return [];
			}
			if (realPath) this.visitedDirs.add(realPath);
		} catch {
			return [];
		}

		this.dirsScanned++;

		const files: ScannedFile[] = [];

		try {
			const entries = await readdir(resolvedPath, { withFileTypes: true });

			for (const entry of entries) {
				const entryPath = join(resolvedPath, entry.name);
				const relPath = relative(this.root, entryPath);

				// Skip if over file limit
				if (this.filesScanned >= this.config.maxScanFiles) {
					this.skippedFiles++;
					continue;
				}

				// Check for symlink escape
				if (entry.isSymbolicLink()) {
					try {
						const target = await readlink(entryPath);
						const targetPath = isAbsolute(target)
							? target
							: join(dirPath, target);
						const resolvedTarget = resolve(targetPath);
						if (!resolvedTarget.startsWith(this.root)) {
							this.errors.push(`Symlink escapes root: ${relPath}`);
							continue;
						}
					} catch {
						// Can't read symlink, skip it
						continue;
					}
				}

				if (entry.isDirectory()) {
					// Skip hidden directories (except .git)
					if (entry.name.startsWith(".") && entry.name !== ".git") {
						continue;
					}

					// Recurse into subdirectory
					const subFiles = await this.scanDir(entryPath, depth + 1);
					files.push(...subFiles);
				} else if (entry.isFile()) {
					this.filesScanned++;
					const fileStat = await stat(entryPath);

					files.push({
						path: entryPath,
						relativePath: relPath,
						size: fileStat.size,
						sensitive: this.isSensitive(relPath),
						generated: this.isGenerated(relPath),
					});
				}
			}
		} catch (err) {
			this.errors.push(`Error reading directory ${relativePath}: ${err}`);
		}

		return files;
	}

	/**
	 * Scan the repository and return all relevant files.
	 */
	async scan(): Promise<ScanResult> {
		const files = await this.scanDir(this.root, 0);

		return {
			files,
			directoriesScanned: this.dirsScanned,
			filesSkipped: this.skippedFiles,
			truncated: this.filesScanned >= this.config.maxScanFiles,
			errors: this.errors,
		};
	}

	/**
	 * Read a file if it's within size limits.
	 */
	async readFileSafe(path: string): Promise<string | null> {
		try {
			const absPath = this.resolvePath(path);
			const fileStat = await stat(absPath);

			if (fileStat.size > this.config.maxFileSize) {
				return null;
			}

			return await readFile(absPath, "utf-8");
		} catch {
			return null;
		}
	}

	/**
	 * Find files matching a pattern.
	 */
	async findFiles(pattern: RegExp, maxResults = 100): Promise<string[]> {
		const results: string[] = [];
		const files = await this.scan();

		for (const file of files.files) {
			if (pattern.test(file.relativePath)) {
				results.push(file.path);
				if (results.length >= maxResults) break;
			}
		}

		return results;
	}

	/**
	 * Check if a path exists within the repository.
	 */
	async exists(path: string): Promise<boolean> {
		try {
			const absPath = this.resolvePath(path);
			await stat(absPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get statistics about the scan.
	 */
	getStats() {
		return {
			filesScanned: this.filesScanned,
			directoriesScanned: this.dirsScanned,
			skippedFiles: this.skippedFiles,
			root: this.root,
		};
	}
}

/**
 * Create a readonly filesystem abstraction from walker.
 */
export function createReadonlyFileSystem(walker: FileSystemWalker): {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<string>;
	readDir(path: string): Promise<string[]>;
	isDirectory(path: string): Promise<boolean>;
	glob(pattern: string, cwd?: string): Promise<string[]>;
} {
	return {
		exists: async (path: string) => walker.exists(path),

		readFile: async (path: string) => {
			const content = await walker.readFileSafe(path);
			if (content === null) {
				throw new Error(`Cannot read file: ${path}`);
			}
			return content;
		},

		readDir: async (path: string) => {
			const absPath = walker.resolvePath(path);
			try {
				const entries = await readdir(absPath);
				return entries;
			} catch {
				return [];
			}
		},

		isDirectory: async (path: string) => {
			try {
				const absPath = walker.resolvePath(path);
				const dirStat = await stat(absPath);
				return dirStat.isDirectory();
			} catch {
				return false;
			}
		},

		glob: async (pattern: string, _cwd?: string) => {
			// Safely convert glob pattern to regex - only allow known safe patterns
			const safePatterns: Record<string, string> = {
				"*.json": "^.+\\.json$",
				"*.ts": "^.+\\.ts$",
				"*.tsx": "^.+\\.tsx$",
				"*.js": "^.+\\.js$",
				"*.jsx": "^.+\\.jsx$",
				"*.py": "^.+\\.py$",
				"*.md": "^.+\\.md$",
				"*.yaml": "^.+\\.yaml$",
				"*.yml": "^.+\\.yml$",
				"package.json": "^package\\.json$",
				"*.config.*": "^.+\\.config\\.[^/]+$",
			};

			const regexPattern = safePatterns[pattern];
			if (!regexPattern) {
				return [];
			}

			const regex = new RegExp(regexPattern);
			return walker.findFiles(regex);
		},
	};
}

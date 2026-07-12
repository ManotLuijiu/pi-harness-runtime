/**
 * Bounded Filesystem Walker
 *
 * Provides safe, bounded filesystem traversal for project analysis.
 * Implements security boundaries to prevent traversal outside repository.
 */
import { readdir, stat, readFile, readlink } from "node:fs/promises";
import { join, relative, isAbsolute, resolve } from "node:path";
import { DEFAULT_ANALYZER_CONFIG } from "./types.js";
/**
 * Match a path against a glob pattern.
 */
function matchesPattern(path, pattern) {
    // Handle simple glob patterns
    if (pattern === "**")
        return true;
    // Handle trailing /** for directory patterns
    if (pattern.endsWith("/**")) {
        const dirPattern = pattern.slice(0, -3);
        if (path.startsWith(dirPattern + "/"))
            return true;
        if (path === dirPattern)
            return true;
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
        if (prefix && !path.startsWith(prefix))
            return false;
        if (suffix && !path.endsWith(suffix))
            return false;
        return true;
    }
    return false;
}
/**
 * Check if a path matches any of the given patterns.
 */
function matchesAnyPattern(path, patterns) {
    return patterns.some((p) => matchesPattern(path, p));
}
/**
 * Bounded filesystem walker for project analysis.
 */
export class FileSystemWalker {
    config;
    root;
    filesScanned = 0;
    dirsScanned = 0;
    skippedFiles = 0;
    errors = [];
    visitedDirs = new Set();
    constructor(root, config) {
        if (!isAbsolute(root)) {
            throw new Error("Repository root must be an absolute path");
        }
        this.root = resolve(root);
        this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
    }
    /**
     * Get canonical path and verify it's within repository root.
     */
    resolvePath(path) {
        const resolved = resolve(this.root, path);
        if (!resolved.startsWith(this.root)) {
            throw new Error(`Path escape attempt detected: ${path}`);
        }
        return resolved;
    }
    /**
     * Check if a path should be skipped based on patterns.
     */
    isSensitive(path) {
        return matchesAnyPattern(path, this.config.sensitivePatterns);
    }
    /**
     * Check if a path is a generated file/directory.
     */
    isGenerated(path) {
        return matchesAnyPattern(path, this.config.generatedPatterns);
    }
    /**
     * Get relative path from repository root.
     */
    getRelativePath(absPath) {
        return relative(this.root, absPath);
    }
    /**
     * Recursively scan directory with depth limiting.
     */
    async scanDir(dirPath, depth) {
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
            if (realPath)
                this.visitedDirs.add(realPath);
        }
        catch {
            return [];
        }
        this.dirsScanned++;
        const files = [];
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
                    }
                    catch {
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
                }
                else if (entry.isFile()) {
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
        }
        catch (err) {
            this.errors.push(`Error reading directory ${relativePath}: ${err}`);
        }
        return files;
    }
    /**
     * Scan the repository and return all relevant files.
     */
    async scan() {
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
    async readFileSafe(path) {
        try {
            const absPath = this.resolvePath(path);
            const fileStat = await stat(absPath);
            if (fileStat.size > this.config.maxFileSize) {
                return null;
            }
            return await readFile(absPath, "utf-8");
        }
        catch {
            return null;
        }
    }
    /**
     * Find files matching a pattern.
     */
    async findFiles(pattern, maxResults = 100) {
        const results = [];
        const files = await this.scan();
        for (const file of files.files) {
            if (pattern.test(file.relativePath)) {
                results.push(file.path);
                if (results.length >= maxResults)
                    break;
            }
        }
        return results;
    }
    /**
     * Check if a path exists within the repository.
     */
    async exists(path) {
        try {
            const absPath = this.resolvePath(path);
            await stat(absPath);
            return true;
        }
        catch {
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
export function createReadonlyFileSystem(walker) {
    return {
        exists: async (path) => walker.exists(path),
        readFile: async (path) => {
            const content = await walker.readFileSafe(path);
            if (content === null) {
                throw new Error(`Cannot read file: ${path}`);
            }
            return content;
        },
        readDir: async (path) => {
            const absPath = walker.resolvePath(path);
            try {
                const entries = await readdir(absPath);
                return entries;
            }
            catch {
                return [];
            }
        },
        isDirectory: async (path) => {
            try {
                const absPath = walker.resolvePath(path);
                const dirStat = await stat(absPath);
                return dirStat.isDirectory();
            }
            catch {
                return false;
            }
        },
        glob: async (pattern, _cwd) => {
            // Safely convert glob pattern to regex - only allow known safe patterns
            const safePatterns = {
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
//# sourceMappingURL=walker.js.map
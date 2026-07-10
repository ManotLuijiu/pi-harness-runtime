/**
 * Bounded Filesystem Walker
 *
 * Provides safe, bounded filesystem traversal for project analysis.
 * Implements security boundaries to prevent traversal outside repository.
 */
import { type AnalyzerConfig } from "./types.js";
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
 * Bounded filesystem walker for project analysis.
 */
export declare class FileSystemWalker {
    private config;
    private root;
    private filesScanned;
    private dirsScanned;
    private skippedFiles;
    private errors;
    private visitedDirs;
    constructor(root: string, config?: Partial<AnalyzerConfig>);
    /**
     * Get canonical path and verify it's within repository root.
     */
    resolvePath(path: string): string;
    /**
     * Check if a path should be skipped based on patterns.
     */
    private isSensitive;
    /**
     * Check if a path is a generated file/directory.
     */
    private isGenerated;
    /**
     * Get relative path from repository root.
     */
    private getRelativePath;
    /**
     * Recursively scan directory with depth limiting.
     */
    private scanDir;
    /**
     * Scan the repository and return all relevant files.
     */
    scan(): Promise<ScanResult>;
    /**
     * Read a file if it's within size limits.
     */
    readFileSafe(path: string): Promise<string | null>;
    /**
     * Find files matching a pattern.
     */
    findFiles(pattern: RegExp, maxResults?: number): Promise<string[]>;
    /**
     * Check if a path exists within the repository.
     */
    exists(path: string): Promise<boolean>;
    /**
     * Get statistics about the scan.
     */
    getStats(): {
        filesScanned: number;
        directoriesScanned: number;
        skippedFiles: number;
        root: string;
    };
}
/**
 * Create a readonly filesystem abstraction from walker.
 */
export declare function createReadonlyFileSystem(walker: FileSystemWalker): {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<string>;
    readDir(path: string): Promise<string[]>;
    isDirectory(path: string): Promise<boolean>;
    glob(pattern: string, cwd?: string): Promise<string[]>;
};
//# sourceMappingURL=walker.d.ts.map
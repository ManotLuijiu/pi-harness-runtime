/**
 * The measured scope of a task.
 *
 * A delegation decision is only worth something when it is based on the
 * work that really has to be done. The numbers of a request are not a
 * measurement: "refactor everything" says nothing about how many files
 * are affected. This module measures the scope in the workspace:
 *
 * - The files of the workspace that the request actually names.
 * - The files the session has already changed.
 * - The groups those files form (one group per package or directory).
 * - The tracked files that reference the measured groups.
 *
 * Every number in the result is a count of something real. When nothing
 * can be measured the result is empty, and the caller has to say so
 * instead of inventing a scope.
 */
/** One group of files that can be worked on together. */
export interface ScopeWorkGroup {
    /** The name of the group: the package or the directory of the files. */
    id: string;
    /** The files of the group. */
    files: string[];
}
/** The measured scope of a task. */
export interface ScopeMeasurement {
    /** The files the measurement found. */
    files: string[];
    /** The groups the files form. */
    groups: ScopeWorkGroup[];
    /** The number of tracked files of the workspace. */
    workspaceFiles: number;
    /** The number of tracked files that reference the measured groups. */
    callSites: number;
    /** The histogram of the file extensions. */
    fileTypes: Record<string, number>;
    /** A stable fingerprint of the measurement. */
    fingerprint: string;
    /** The hints of the request that matched a file of the workspace. */
    matchedHints: string[];
    /** How the files were found: the request named them, or the session changed them. */
    source: "request" | "working-tree" | "none";
}
/** The options of {@link measureScope}. */
export interface MeasureScopeOptions {
    /** The root of the workspace. */
    workspacePath: string;
    /** The path fragments of the request, for example a package name. */
    hints?: string[];
    /** The files the session has changed in the workspace. */
    changedFiles?: string[];
    /** The upper bound of the files of one measurement. */
    limit?: number;
}
/**
 * The files the working tree has changed.
 */
export declare function changedFiles(workspacePath: string): string[];
/**
 * The group a file belongs to: its package, or its top directory.
 */
export declare function moduleOf(file: string): string;
/**
 * The extension of a file, without the dot.
 */
export declare function extensionOf(file: string): string;
/**
 * Group the measured files.
 */
export declare function groupFiles(files: string[]): ScopeWorkGroup[];
/**
 * A stable fingerprint of a set of files.
 */
export declare function fingerprintOf(files: string[]): string;
/**
 * The path fragments of a request.
 *
 * A hint is a place in the repository that the request names: a path with
 * a separator, or a file name with a known extension. The measurement
 * checks every hint against the tracked files, so a hint that names
 * nothing is simply not used.
 */
export declare function scopeHintsFromText(text: string): string[];
/**
 * Measure the scope of a task in the workspace.
 */
export declare function measureScope(options: MeasureScopeOptions): ScopeMeasurement;
//# sourceMappingURL=delegation-scope.d.ts.map
/**
 * Detection utilities for checking if rpiv-todo is installed
 */
/**
 * Check if @juicesharp/rpiv-todo is installed globally via npm
 */
export declare function isRpivTodoInstalled(): boolean;
/**
 * Check if rpiv-todo is loaded in pi extensions
 * This checks common extension directories
 */
export declare function isRpivTodoLoaded(): boolean;
/**
 * Get the version of rpiv-todo if installed
 */
export declare function getRpivTodoVersion(): string | null;
/**
 * Check if bd CLI is installed
 */
export declare function isBdInstalled(): boolean;
/**
 * Check if bd is initialized in the current project
 * (i.e., .beads/ directory exists)
 */
export declare function isBdInitialized(cwd?: string): boolean;
/**
 * Get the version of bd CLI if installed
 */
export declare function getBdVersion(): string | null;
/**
 * Get installation status of both dependencies
 */
/**
 * Get installation status of both dependencies
 */
export interface DependencyStatus {
    rpivTodo: {
        installed: boolean;
        version: string | null;
        loaded: boolean;
    };
    bd: {
        installed: boolean;
        version: string | null;
        initialized: boolean;
        installUrl: string;
    };
}
export declare function getDependencyStatus(cwd?: string): DependencyStatus;
/**
 * Log dependency status for debugging
 */
export declare function logDependencyStatus(): void;
//# sourceMappingURL=detector.d.ts.map
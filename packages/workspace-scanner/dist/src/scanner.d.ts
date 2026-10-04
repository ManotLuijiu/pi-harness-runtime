/**
 * Workspace Scanner — Main Scanner
 */
import type { ScannerOptions, WorkspaceSnapshot } from "./types.js";
export declare class WorkspaceScanner {
    private root;
    constructor(root: string);
    scan(opts?: ScannerOptions): Promise<WorkspaceSnapshot>;
}
export declare function scanWorkspace(rootPath: string, opts?: ScannerOptions): Promise<WorkspaceSnapshot>;
//# sourceMappingURL=scanner.d.ts.map
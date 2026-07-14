/**
 * Doc Generator — Project Detection (RFC-0014)
 */
import type { ProjectDetection } from "./types.js";
/** Detect project type from a list of file paths. */
export declare function detectProjectType(filePaths: string[]): ProjectDetection;
/** Parse signals from a directory listing. */
export declare function parseSignals(entries: string[]): string[];
//# sourceMappingURL=detector.d.ts.map
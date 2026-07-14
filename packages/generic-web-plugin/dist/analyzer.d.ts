/**
 * Generic Web Plugin — Analyzer (RFC-0066)
 *
 * Detects and deeply analyzes generic web projects.
 */
import type { GenericWebAnalysis } from "./types.js";
/**
 * Detect if a directory is a generic web project
 */
export declare function detectWeb(root: string): Promise<boolean>;
/**
 * Deep analysis of a generic web project
 */
export declare function analyzeWeb(root: string): Promise<GenericWebAnalysis | null>;
//# sourceMappingURL=analyzer.d.ts.map
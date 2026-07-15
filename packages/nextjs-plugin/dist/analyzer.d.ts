/**
 * Next.js Analyzer (RFC-0062)
 *
 * Deep analysis of Next.js workspaces via filesystem inspection.
 * Does NOT evaluate code or connect to the network.
 */
import type { NextJsAnalysis } from "./types.js";
/**
 * Analyze a Next.js workspace (RFC-0062)
 */
export declare function analyzeNextJs(root: string): Promise<NextJsAnalysis | null>;
//# sourceMappingURL=analyzer.d.ts.map
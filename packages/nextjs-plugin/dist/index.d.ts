/**
 * Next.js Plugin — Main Entry (RFC-0062)
 */
import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
export type { NextJsAnalysis, AppRoute, ConfigFile } from "./types.js";
export declare function analyzeNextJsWorkspace(root: string): Promise<import("./types.js").NextJsAnalysis | null>;
export declare function createNextJsPlugin(): FrameworkExtension;
//# sourceMappingURL=index.d.ts.map
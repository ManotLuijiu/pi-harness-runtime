/**
 * React/Vite Plugin — Main Entry (RFC-0063)
 */
import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
export type { ReactViteAnalysis, ConfigFile } from "./types.js";
export declare function analyzeReactViteWorkspace(root: string): Promise<import("./types.js").ReactViteAnalysis | null>;
export declare function createReactVitePlugin(): FrameworkExtension;
//# sourceMappingURL=index.d.ts.map
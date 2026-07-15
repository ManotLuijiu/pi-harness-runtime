/**
 * Laravel Plugin — Main Entry (RFC-0065)
 */
import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
export type { LaravelAnalysis } from "./types.js";
export declare function analyzeLaravelWorkspace(root: string): Promise<import("./types.js").LaravelAnalysis | null>;
export declare function createLaravelPlugin(): FrameworkExtension;
//# sourceMappingURL=index.d.ts.map
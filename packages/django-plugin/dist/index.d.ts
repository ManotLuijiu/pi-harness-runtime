/**
 * Django Plugin — Main Entry (RFC-0064)
 */
import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
export type { DjangoAnalysis, DjangoApp, ConfigFile } from "./types.js";
export declare function analyzeDjangoWorkspace(root: string): Promise<import("./types.js").DjangoAnalysis | null>;
export declare function createDjangoPlugin(): FrameworkExtension;
//# sourceMappingURL=index.d.ts.map
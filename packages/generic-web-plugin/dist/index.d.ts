/**
 * Generic Web Plugin — Main Entry (RFC-0066)
 */
import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
export type { GenericWebAnalysis, WebFrameworkType, PageRoute, ApiEndpoint } from "./types.js";
/**
 * Analyze a generic web project (RFC-0066)
 */
export declare function analyzeWebWorkspace(workspaceRoot: string): Promise<import("./types.js").GenericWebAnalysis | null>;
/**
 * Generic Web Framework Plugin (RFC-0066)
 *
 * Detects and deeply analyzes generic web frameworks:
 * - Framework type detection (Next.js, Nuxt, Remix, Astro, Express, Fastify, etc.)
 * - Route file discovery (pages, app/, components)
 * - API endpoint scanning (routes/, pages/api/, controllers)
 * - SSR/static detection
 */
export declare function createGenericWebPlugin(): FrameworkExtension;
//# sourceMappingURL=index.d.ts.map
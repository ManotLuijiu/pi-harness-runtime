/**
 * Frappe Plugin — Main Entry (RFC-0061)
 */
import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
import type { FrameworkInfo } from "../../framework-detector/src/types.js";
export type { FrappeAnalysis, FrappeSite, FrappeApp, FrappeDocTypeSummary, FrappeHooksSummary, FrappeCustomFieldSummary, } from "./types.js";
/**
 * Analyze a Frappe workspace (RFC-0061)
 */
export declare function analyzeFrappeWorkspace(workspaceRoot: string): Promise<import("./types.js").FrappeAnalysis | null>;
/**
 * Get framework info from a Frappe workspace.
 */
export declare function detectFrappeFramework(workspaceRoot: string): Promise<FrameworkInfo | null>;
/**
 * Frappe Framework Plugin (RFC-0061)
 *
 * Deep analysis for Frappe/ERPNext/Frappe SPA workspaces:
 * - Bench structure and site discovery
 * - App listing from apps.txt
 * - DocType enumeration with field counts
 * - hooks.py parsing (docevents, fixtures, app_name, etc.)
 * - Custom field / property setter estimation via FGD files
 * - ERPNext and Frappe SPA detection via package.json deps
 */
export declare function createFrappePlugin(): FrameworkExtension;
//# sourceMappingURL=index.d.ts.map
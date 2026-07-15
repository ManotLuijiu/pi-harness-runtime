/**
 * Frappe Plugin — Types (RFC-0061)
 */
import type { FrameworkInfo } from "../../framework-detector/src/types.js";
export interface FrappeAnalysis {
    framework: FrameworkInfo;
    benchPath?: string;
    sites: FrappeSite[];
    apps: FrappeApp[];
    doctypes: FrappeDocTypeSummary[];
    hooks: FrappeHooksSummary[];
    customFields: FrappeCustomFieldSummary;
    version?: string;
    isErpNext: boolean;
    hasSPA: boolean;
}
export interface FrappeSite {
    name: string;
    path: string;
    dbPort?: number;
    redisPort?: number;
    mariadbHost?: string;
    hasSiteConfig: boolean;
}
export interface FrappeApp {
    name: string;
    path: string;
    version?: string;
    moduleCount: number;
    doctypeCount: number;
    hasHooks: boolean;
    hasWorkspace: boolean;
    hasPublicFiles: boolean;
}
export interface FrappeDocTypeSummary {
    name: string;
    module: string;
    custom: boolean;
    isSubmittable: boolean;
    singleDoc: boolean;
    nFields: number;
}
export interface FrappeHooksSummary {
    appName: string;
    hooks: Record<string, string[]>;
}
export interface FrappeCustomFieldSummary {
    totalCustomFields: number;
    totalPropertySetters: number;
    linkedTo: string[];
}
export interface FrappeWorkspaceSummary {
    benchPath: string;
    siteCount: number;
    appCount: number;
    doctypeCount: number;
    isErpNext: boolean;
    version?: string;
    hasSPA: boolean;
}
export interface ModuleInfo {
    name: string;
    path: string;
    doctypeCount: number;
}
export interface SiteInfo {
    name: string;
    path: string;
    dbPort?: number;
    redisPort?: number;
    mariadbHost?: string;
    hasSiteConfig: boolean;
}
export interface HooksFile {
    appName: string;
    hooks: Record<string, string[]>;
    version?: string;
}
export interface FrappePluginConfig {
    /** Custom paths to include in analysis */
    customPaths?: string[];
    /** Include custom fields in analysis */
    includeCustomFields?: boolean;
    /** Include workspace analysis */
    includeWorkspace?: boolean;
}
export declare class FrappeWorkspaceError extends Error {
    readonly code: "INVALID_WORKSPACE" | "NOT_FRAPPE" | "PARSE_ERROR" | "BENCH_NOT_FOUND";
    constructor(message: string, code?: FrappeWorkspaceError["code"]);
}
//# sourceMappingURL=types.d.ts.map
/**
 * Frappe Plugin — Types (RFC-0061)
 */

import type { FrameworkInfo } from "../../framework-detector/src/types.js";

// ─── Analysis Result ──────────────────────────────────────────────────────────

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

// ─── Site ─────────────────────────────────────────────────────────────────────

export interface FrappeSite {
	name: string;
	path: string;
	dbPort?: number;
	redisPort?: number;
	mariadbHost?: string;
	hasSiteConfig: boolean;
}

// ─── App ─────────────────────────────────────────────────────────────────────

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

// ─── DocType ──────────────────────────────────────────────────────────────────

export interface FrappeDocTypeSummary {
	name: string;
	module: string;
	custom: boolean;
	isSubmittable: boolean;
	singleDoc: boolean;
	nFields: number;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export interface FrappeHooksSummary {
	appName: string;
	hooks: Record<string, string[]>;
}

// ─── Custom Fields ────────────────────────────────────────────────────────────

export interface FrappeCustomFieldSummary {
	totalCustomFields: number;
	totalPropertySetters: number;
	linkedTo: string[];
}

// ─── Workspace ────────────────────────────────────────────────────────────────

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

// ─── Hooks File ───────────────────────────────────────────────────────────────

export interface HooksFile {
	appName: string;
	hooks: Record<string, string[]>;
	version?: string;
}

// ─── Plugin Config ────────────────────────────────────────────────────────────

export interface FrappePluginConfig {
	/** Custom paths to include in analysis */
	customPaths?: string[];
	/** Include custom fields in analysis */
	includeCustomFields?: boolean;
	/** Include workspace analysis */
	includeWorkspace?: boolean;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class FrappeWorkspaceError extends Error {
	readonly code:
		| "INVALID_WORKSPACE"
		| "NOT_FRAPPE"
		| "PARSE_ERROR"
		| "BENCH_NOT_FOUND";

	constructor(
		message: string,
		code: FrappeWorkspaceError["code"] = "INVALID_WORKSPACE",
	) {
		super(message);
		this.name = "FrappeWorkspaceError";
		this.code = code;
	}
}

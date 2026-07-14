/**
 * Frappe Plugin — Main Entry (RFC-0061)
 */

import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
import type { FrameworkInfo } from "../../framework-detector/src/types.js";
import { analyzeFrappe } from "./analyzer.js";

export type {
	FrappeAnalysis,
	FrappeSite,
	FrappeApp,
	FrappeDocTypeSummary,
	FrappeHooksSummary,
	FrappeCustomFieldSummary,
} from "./types.js";

/**
 * Analyze a Frappe workspace (RFC-0061)
 */
export async function analyzeFrappeWorkspace(
	workspaceRoot: string,
): Promise<import("./types.js").FrappeAnalysis | null> {
	return analyzeFrappe(workspaceRoot);
}

/**
 * Get framework info from a Frappe workspace.
 */
export async function detectFrappeFramework(
	workspaceRoot: string,
): Promise<FrameworkInfo | null> {
	const analysis = await analyzeFrappe(workspaceRoot);
	return analysis?.framework ?? null;
}

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
export function createFrappePlugin(): FrameworkExtension {
	return {
		capability: "framework",
		name: "Frappe Framework Plugin",
		detector: {
			detect: async (workspaceRoot: unknown): Promise<unknown> => {
				const root = workspaceRoot as string;
				const { existsSync } = await import("node:fs");
				return (
					existsSync(`${root}/sites`) ||
					existsSync(`${root}/apps.txt`) ||
					existsSync(`${root}/frappe-bench/sites`) ||
					existsSync(`${root}/frappe-bench/sites.txt`)
				);
			},
			signals: [
				{ type: "directory", pattern: "frappe-bench/sites", weight: 0.8 },
				{ type: "file", pattern: "apps.txt", weight: 0.6 },
				{ type: "directory", pattern: "sites", weight: 0.4 },
				{ type: "file", pattern: "frappe-bench/sites.txt", weight: 0.5 },
			],
		},
		config: {},
	};
}

/**
 * Frappe Plugin — Analyzer (RFC-0061)
 *
 * Deep analysis of Frappe/ERPNext workspaces via filesystem inspection.
 * Does NOT connect to databases or run bench commands.
 */
import type { FrappeAnalysis } from "./types.js";
/**
 * Analyze a Frappe workspace (RFC-0061)
 *
 * Scans bench directory structure, apps, DocTypes, hooks, and sites.
 * Does NOT connect to databases or run CLI commands.
 */
export declare function analyzeFrappe(workspaceRoot: string): Promise<FrappeAnalysis | null>;
//# sourceMappingURL=analyzer.d.ts.map
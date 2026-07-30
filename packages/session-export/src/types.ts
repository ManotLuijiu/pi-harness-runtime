/**
 * Session Export — Types
 */

export type ExportFormat = "markdown" | "json" | "text" | "html";

export interface ExportRequest {
	sessionId?: string;
	format: ExportFormat;
	includeEvents?: boolean;
	includeDecisions?: boolean;
	includeTasks?: boolean;
	since?: string;
}

export interface ExportResult {
	content: string;
	format: ExportFormat;
	filename: string;
	generatedAt: string;
	eventCount: number;
}

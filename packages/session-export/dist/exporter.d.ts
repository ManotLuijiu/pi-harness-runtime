/**
 * Session Export — Export session to various formats
 */
interface SessionEvent {
    id: string;
    timestamp: string;
    type: string;
    role?: string;
    content?: string;
}
interface ExportRequest {
    sessionId?: string;
    format: "markdown" | "json" | "text" | "html";
    includeEvents?: boolean;
    includeDecisions?: boolean;
    includeTasks?: boolean;
    since?: string;
}
interface ExportResult {
    content: string;
    format: "markdown" | "json" | "text" | "html";
    filename: string;
    generatedAt: string;
    eventCount: number;
}
export declare function exportSession(request: ExportRequest, events: SessionEvent[]): ExportResult;
export {};
//# sourceMappingURL=exporter.d.ts.map
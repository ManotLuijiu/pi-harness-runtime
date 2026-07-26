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

function toMarkdown(events: SessionEvent[]): string {
	const lines = ["# Session\n"];
	for (const evt of events) {
		const role = evt.role ?? evt.type;
		lines.push(`**${role}** (${evt.timestamp}): ${evt.content ?? ""}`);
	}
	return lines.join("\n");
}

function toJson(events: SessionEvent[]): string {
	return JSON.stringify({ events, exportedAt: new Date().toISOString() }, null, 2);
}

function toText(events: SessionEvent[]): string {
	return events.map((e) => `[${e.timestamp}] ${e.role ?? e.type}: ${e.content ?? ""}`).join("\n");
}

function toHtml(events: SessionEvent[]): string {
	const body = events.map((e) => `<li><strong>${e.role ?? e.type}</strong>: ${e.content ?? ""}</li>`).join("\n");
	return `<!DOCTYPE html><html><body><ul>${body}</ul></body></html>`;
}

export function exportSession(request: ExportRequest, events: SessionEvent[]): ExportResult {
	const generators: Record<string, (e: SessionEvent[]) => string> = {
		markdown: toMarkdown,
		json: toJson,
		text: toText,
		html: toHtml,
	};
	const content = (generators[request.format] ?? toMarkdown)(events);
	return {
		content,
		format: request.format,
		filename: `session-${Date.now()}.${request.format}`,
		generatedAt: new Date().toISOString(),
		eventCount: events.length,
	};
}

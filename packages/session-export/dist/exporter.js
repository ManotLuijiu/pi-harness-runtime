/**
 * Session Export — Export session to various formats
 */
function toMarkdown(events) {
    const lines = ["# Session\n"];
    for (const evt of events) {
        const role = evt.role ?? evt.type;
        lines.push(`**${role}** (${evt.timestamp}): ${evt.content ?? ""}`);
    }
    return lines.join("\n");
}
function toJson(events) {
    return JSON.stringify({ events, exportedAt: new Date().toISOString() }, null, 2);
}
function toText(events) {
    return events.map((e) => `[${e.timestamp}] ${e.role ?? e.type}: ${e.content ?? ""}`).join("\n");
}
function toHtml(events) {
    const body = events.map((e) => `<li><strong>${e.role ?? e.type}</strong>: ${e.content ?? ""}</li>`).join("\n");
    return `<!DOCTYPE html><html><body><ul>${body}</ul></body></html>`;
}
export function exportSession(request, events) {
    const generators = {
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
//# sourceMappingURL=exporter.js.map
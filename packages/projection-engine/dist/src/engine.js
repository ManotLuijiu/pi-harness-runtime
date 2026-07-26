/**
 * Projection Engine — Core
 */
export class ProjectionEngine {
    decisions = [];
    taskStates = new Map();
    agentTimelines = new Map();
    messages = 0;
    tools = 0;
    topics = new Set();
    sessionId = "";
    addEvent(event) {
        this.sessionId = event.sessionId;
        if (event.type === "message") {
            this.messages++;
            if (event.role === "assistant") {
                const text = event.content ?? "";
                if (/RFC|ADR|architecture decision|design choice/i.test(text)) {
                    this.decisions.push({
                        id: event.id,
                        sessionId: this.sessionId,
                        timestamp: event.timestamp,
                        text,
                        confidence: 0.8,
                        sources: [],
                    });
                }
                const topicKeywords = ["deploy", "test", "fix", "refactor", "migrate", "security"];
                for (const kw of topicKeywords) {
                    if (text.toLowerCase().includes(kw))
                        this.topics.add(kw);
                }
            }
        }
        if (event.type === "tool_start")
            this.tools++;
        if (event.type === "assistant_end") {
            const id = event.metadata?.model ?? "unknown";
            if (!this.agentTimelines.has(id)) {
                this.agentTimelines.set(id, { agentId: id, events: [] });
            }
            this.agentTimelines.get(id).events.push({
                timestamp: event.timestamp,
                type: "assistant_end",
                message: event.content ?? "",
            });
        }
    }
    getDecisions() { return this.decisions; }
    getTaskStates() { return [...this.taskStates.values()]; }
    getSummary() {
        return {
            sessionId: this.sessionId,
            durationMs: 0,
            messageCount: this.messages,
            toolCount: this.tools,
            decisionCount: this.decisions.length,
            taskCount: this.taskStates.size,
            topics: [...this.topics],
        };
    }
    getTimeline(agentId) {
        if (agentId)
            return [this.agentTimelines.get(agentId)].filter(Boolean);
        return [...this.agentTimelines.values()];
    }
    reset() {
        this.decisions = [];
        this.taskStates.clear();
        this.agentTimelines.clear();
        this.messages = 0;
        this.tools = 0;
        this.topics.clear();
    }
}
//# sourceMappingURL=engine.js.map
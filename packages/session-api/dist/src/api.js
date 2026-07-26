/**
 * Session API — Safe API for agents
 */
export class SessionServiceImpl {
    events = [];
    decisions = [];
    tasks = [];
    summary = { sessionId: "", durationMs: 0, messageCount: 0, toolCount: 0, decisionCount: 0, taskCount: 0, topics: [] };
    loadEvents(events) { this.events = events; }
    async getLatestDecision() {
        return this.decisions[this.decisions.length - 1] ?? null;
    }
    async getLatestTask() {
        return this.tasks[this.tasks.length - 1] ?? null;
    }
    async getRecentFailures(limit = 10) {
        return this.events.filter((e) => e.type === "tool_error").slice(-limit);
    }
    async getArchitectureHistory() { return []; }
    async getWorkflowState() {
        return { id: "main", status: "running", tasks: [], blockers: [] };
    }
    async getLatestSummary() { return this.summary; }
    async search(query) {
        const q = query.toLowerCase();
        return this.events.filter((e) => e.content?.toLowerCase().includes(q));
    }
    async getAgentTimeline(agentId) {
        return { agentId, events: [] };
    }
    async getSessionTimeline(limit = 100) {
        return this.events.slice(-limit);
    }
}
//# sourceMappingURL=api.js.map
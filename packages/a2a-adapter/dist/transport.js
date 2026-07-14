/**
 * A2A Adapter — HTTP Transport (RFC-0069)
 */
/**
 * HTTP client for A2A protocol
 */
export class A2ATransport {
    baseUrl;
    config;
    constructor(baseUrl, config = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.config = config;
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...this.config.headers,
        };
        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(this.config.timeout ?? 30000),
        });
        if (!response.ok) {
            throw new Error(`A2A HTTP error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    /**
     * Fetch agent card from well-known endpoint
     */
    async getAgentCard() {
        return this.request("GET", "/.well-known/agent.json");
    }
    /**
     * Send a task message to an agent
     */
    async sendTask(params) {
        return this.request("POST", "/a2a/tasks/send", {
            jsonrpc: "2.0",
            method: "tasks/send",
            params,
        });
    }
    /**
     * Send task with streaming subscription
     */
    async sendTaskSubscribe(params) {
        return this.request("POST", "/a2a/tasks/sendSubscribe", {
            jsonrpc: "2.0",
            method: "tasks/sendSubscribe",
            params,
        });
    }
    /**
     * Get task status
     */
    async getTask(taskId) {
        return this.request("GET", `/a2a/tasks/${taskId}`);
    }
    /**
     * Cancel a task
     */
    async cancelTask(taskId) {
        return this.request("POST", `/a2a/tasks/${taskId}/cancel`);
    }
    /**
     * SSE stream for task updates
     */
    async *streamTaskUpdates(taskId) {
        const url = `${this.baseUrl}/a2a/tasks/${taskId}/stream`;
        const response = await fetch(url, {
            headers: {
                Accept: "text/event-stream",
                ...this.config.headers,
            },
            signal: AbortSignal.timeout(this.config.timeout ?? 60000),
        });
        if (!response.ok || !response.body) {
            throw new Error(`Stream error: ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = JSON.parse(line.slice(6));
                        yield data;
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
}
//# sourceMappingURL=transport.js.map
/**
 * DeepAgents Adapter — RFC-0029
 *
 * Implements the AgentWorker interface for DeepAgents.
 * DeepAgents is an optional Agent Worker; Runtime remains the orchestrator.
 *
 * @module deepagents-adapter
 */
/**
 * DeepAgents Adapter
 *
 * Connects the harness runtime to a DeepAgents worker.
 * Runtime orchestrates; DeepAgents executes tasks.
 */
export class DeepAgentsAdapter {
    id;
    provider = "deepagents";
    config = null;
    _status = "idle";
    abortController = null;
    currentTaskId = null;
    constructor(id) {
        this.id = id;
    }
    /**
     * Initialize the DeepAgents adapter
     */
    async initialize(config) {
        if (config.provider !== "deepagents") {
            throw new Error(`Invalid provider: ${config.provider}. Expected "deepagents".`);
        }
        this.config = config;
        this._status = "initializing";
        // Validate configuration
        if (!this.config.endpoint) {
            throw new Error("DeepAgents endpoint is required");
        }
        // Test connection to DeepAgents server
        try {
            await this.health();
        }
        catch (error) {
            this._status = "error";
            throw new Error(`Failed to connect to DeepAgents at ${this.config.endpoint}: ${error instanceof Error ? error.message : String(error)}`);
        }
        this._status = "idle";
    }
    /**
     * Execute a task using DeepAgents
     */
    async execute(request, events) {
        if (!this.config) {
            throw new Error("Agent not initialized. Call initialize() first.");
        }
        if (this._status === "stopped") {
            throw new Error("Agent has been stopped");
        }
        const startTime = Date.now();
        this._status = "running";
        this.currentTaskId = request.task.id;
        this.abortController = new AbortController();
        // Emit status change
        events?.onStatusChange?.("running");
        try {
            // Report planning phase
            const planningProgress = {
                taskId: request.task.id,
                phase: "planning",
                message: `Planning task: ${request.task.title}`,
                percentComplete: 10,
                timestamp: new Date().toISOString(),
            };
            events?.onProgress?.(request.task.id, planningProgress);
            // Build DeepAgents request
            const deepAgentsRequest = this.buildDeepAgentsRequest(request);
            // Report executing phase
            const executingProgress = {
                taskId: request.task.id,
                phase: "executing",
                message: `Executing task: ${request.task.title}`,
                percentComplete: 30,
                timestamp: new Date().toISOString(),
            };
            events?.onProgress?.(request.task.id, executingProgress);
            // Execute via DeepAgents
            const response = await this.callDeepAgents(deepAgentsRequest);
            // Report reviewing phase
            const reviewingProgress = {
                taskId: request.task.id,
                phase: "reviewing",
                message: "Reviewing results",
                percentComplete: 80,
                timestamp: new Date().toISOString(),
            };
            events?.onProgress?.(request.task.id, reviewingProgress);
            // Parse response and build result
            const result = this.parseDeepAgentsResponse(request.task, response, startTime);
            // Report finalizing phase
            const finalizingProgress = {
                taskId: request.task.id,
                phase: "finalizing",
                message: "Finalizing task",
                percentComplete: 100,
                timestamp: new Date().toISOString(),
            };
            events?.onProgress?.(request.task.id, finalizingProgress);
            // Emit completion
            events?.onTaskComplete?.(result);
            this._status = "idle";
            this.currentTaskId = null;
            events?.onStatusChange?.("idle");
            return result;
        }
        catch (error) {
            this._status = "error";
            this.currentTaskId = null;
            events?.onStatusChange?.("error");
            const taskError = error instanceof Error ? error : new Error(String(error));
            events?.onError?.(request.task.id, taskError);
            // Return failure result
            return {
                taskId: request.task.id,
                status: "failure",
                summary: `Task failed: ${taskError.message}`,
                error: taskError.message,
                durationMs: Date.now() - startTime,
                completedAt: new Date().toISOString(),
            };
        }
    }
    /**
     * Check health of DeepAgents connection
     */
    async health() {
        if (!this.config) {
            return {
                healthy: false,
                status: this._status,
                load: 0,
                activeTasks: 0,
                queueDepth: 0,
                checkedAt: new Date().toISOString(),
                error: "Not initialized",
            };
        }
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${this.config.endpoint}/health`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.config.apiKey && {
                        Authorization: `Bearer ${this.config.apiKey}`,
                    }),
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                return {
                    healthy: false,
                    status: this._status,
                    load: this.currentTaskId ? 1 : 0,
                    activeTasks: this.currentTaskId ? 1 : 0,
                    queueDepth: 0,
                    checkedAt: new Date().toISOString(),
                    error: `Health check failed: ${response.status}`,
                };
            }
            const data = (await response.json());
            return {
                healthy: true,
                status: this._status,
                load: data.load ?? 0,
                activeTasks: data.activeTasks ?? (this.currentTaskId ? 1 : 0),
                queueDepth: data.queueDepth ?? 0,
                checkedAt: new Date().toISOString(),
            };
        }
        catch (error) {
            return {
                healthy: false,
                status: this._status,
                load: this.currentTaskId ? 1 : 0,
                activeTasks: this.currentTaskId ? 1 : 0,
                queueDepth: 0,
                checkedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : "Health check failed",
            };
        }
    }
    /**
     * Get current status
     */
    status() {
        return this._status;
    }
    /**
     * Pause the agent
     */
    async pause() {
        if (this._status === "running" && this.abortController) {
            this.abortController.abort();
        }
        this._status = "paused";
    }
    /**
     * Resume the agent
     */
    async resume() {
        if (this._status === "paused") {
            this._status = "idle";
        }
    }
    /**
     * Stop the agent
     */
    async stop() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this._status = "stopped";
        this.currentTaskId = null;
    }
    /**
     * Check if a model is supported
     */
    supportsModel(model) {
        const supported = this.config?.supportedModels ?? ["deepagents/default"];
        return supported.some((m) => m.toLowerCase() === model.toLowerCase() || m === "*");
    }
    /**
     * Get supported models
     */
    getSupportedModels() {
        return this.config?.supportedModels ?? ["deepagents/default"];
    }
    // --- Private Methods ------------------------------------------------
    /**
     * Build a DeepAgents API request from a task request
     */
    buildDeepAgentsRequest(request) {
        const deepRequest = {
            task: {
                id: request.task.id,
                title: request.task.title,
                description: request.task.description,
                acceptanceCriteria: request.task.acceptanceCriteria,
            },
            workingDir: request.workingDir,
            context: request.context,
            config: request.config,
        };
        return deepRequest;
    }
    /**
     * Call the DeepAgents API
     */
    async callDeepAgents(request) {
        if (!this.config) {
            throw new Error("Not initialized");
        }
        const controller = this.abortController ?? new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 300000);
        try {
            const response = await fetch(`${this.config.endpoint}/tasks/execute`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.config.apiKey && {
                        Authorization: `Bearer ${this.config.apiKey}`,
                    }),
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                throw new Error(`DeepAgents API error: ${response.status} ${response.statusText} - ${errorBody}`);
            }
            const result = (await response.json());
            return result;
        }
        catch (error) {
            clearTimeout(timeout);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Task was cancelled");
            }
            throw error;
        }
    }
    /**
     * Parse DeepAgents response into TaskResult
     */
    parseDeepAgentsResponse(task, response, startTime) {
        const status = response.status;
        const durationMs = Date.now() - startTime;
        const result = {
            taskId: task.id,
            status,
            summary: response.summary,
            filesChanged: response.filesChanged,
            output: response.output,
            error: response.error,
            usage: response.usage,
            durationMs,
            completedAt: new Date().toISOString(),
            metadata: response.metadata,
        };
        return result;
    }
}
/**
 * Factory function to create a DeepAgentsAdapter
 * Matches AgentWorkerFactory signature from RFC-0030
 */
export function createDeepAgentsAdapter(config) {
    const adapter = new DeepAgentsAdapter(config.id ?? `deepagents-${Date.now()}`);
    return adapter;
}
//# sourceMappingURL=deepagents-adapter.js.map
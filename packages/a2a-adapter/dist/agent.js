/**
 * A2A Adapter — A2A Agent (RFC-0069)
 *
 * Expose this harness agent as an A2A-compatible agent.
 */
/**
 * Task store — in-memory for now
 */
const taskStore = new Map();
let taskCounter = 0;
/**
 * Create an AgentCard for this harness agent
 */
export function createAgentCard(config) {
    return {
        name: config.name,
        description: config.description,
        url: config.url,
        version: config.version,
        capabilities: {
            streaming: true,
            pushNotifications: false,
            stateTransitionHistory: false,
            ...config.capabilities,
        },
        skills: config.skills ?? [
            {
                id: "code-analysis",
                name: "Code Analysis",
                description: "Analyze code structure, dependencies, and quality",
                tags: ["code", "analysis", "static-analysis"],
                inputModes: ["text"],
                outputModes: ["text"],
            },
            {
                id: "code-generation",
                name: "Code Generation",
                description: "Generate code from specifications",
                tags: ["code", "generation", "scaffolding"],
                inputModes: ["text"],
                outputModes: ["text"],
            },
        ],
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
    };
}
/**
 * Route incoming A2A task to harness skill-registry
 */
export async function routeTask(message) {
    const taskId = `task-${++taskCounter}-${Date.now()}`;
    const task = {
        id: taskId,
        status: "working",
        kind: "message",
        artifacts: [],
    };
    taskStore.set(taskId, task);
    try {
        const response = await processMessage(message);
        task.artifacts = [
            {
                name: "response",
                description: "Agent response",
                parts: [{ type: "text", text: response }],
            },
        ];
        task.status = "completed";
    }
    catch (err) {
        task.status = "failed";
        const msg = err instanceof Error ? err.message : String(err);
        task.artifacts = [{ parts: [{ type: "text", text: `Error: ${msg}` }] }];
    }
    taskStore.set(taskId, task);
    return task;
}
/**
 * Process message — stub for harness integration
 */
async function processMessage(message) {
    return `[A2A Stub] Received: ${message.content}. This would be processed by the harness skill-registry.`;
}
/**
 * Get task by ID
 */
export function getTask(taskId) {
    return taskStore.get(taskId) ?? null;
}
/**
 * Cancel a task
 */
export function cancelTask(taskId) {
    const task = taskStore.get(taskId);
    if (!task)
        return false;
    task.status = "canceled";
    taskStore.set(taskId, task);
    return true;
}
/**
 * Generate task status update SSE
 */
export function taskStatusUpdateSSE(taskId) {
    const task = taskStore.get(taskId);
    if (!task)
        return "";
    // Inline SSE formatting to avoid dynamic require at module level
    return (`event: task_status_update\ndata: ` +
        JSON.stringify({
            taskId: task.id,
            status: task.status,
            final: task.status === "completed" ||
                task.status === "failed" ||
                task.status === "canceled",
        }) +
        "\n\n");
}
//# sourceMappingURL=agent.js.map
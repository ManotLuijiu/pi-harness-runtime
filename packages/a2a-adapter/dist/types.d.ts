/**
 * A2A Adapter — Types (RFC-0069)
 */
export interface AgentCard {
    name: string;
    description: string;
    url: string;
    version: string;
    capabilities: AgentCapabilities;
    skills: Skill[];
    authentication?: Authentication;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
}
export interface AgentCapabilities {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
}
export interface Skill {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    inputModes?: string[];
    outputModes?: string[];
}
export interface Authentication {
    schemes: string[];
    credentials?: string;
}
export type TaskStatus = "submitted" | "working" | "completed" | "canceled" | "failed";
export interface Task {
    id: string;
    sessionId?: string;
    status: TaskStatus;
    artifacts?: Artifact[];
    kind: "message" | "search" | "task";
}
export interface TaskStatusUpdateEvent {
    taskId: string;
    status: TaskStatus;
    message?: TaskMessage;
    final?: boolean;
}
export interface TaskMessage {
    role: "agent" | "user";
    content: string;
}
export interface Artifact {
    name?: string;
    description?: string;
    parts: Array<{
        type: "text";
        text: string;
    }>;
}
export type A2ARequest = {
    method: "tasks/send";
    params: {
        taskId?: string;
        sessionId?: string;
        message: TaskMessage;
    };
} | {
    method: "tasks/sendSubscribe";
    params: {
        taskId?: string;
        sessionId?: string;
        message: TaskMessage;
    };
} | {
    method: "tasks/get";
    params: {
        taskId: string;
    };
} | {
    method: "tasks/cancel";
    params: {
        taskId: string;
    };
} | {
    method: "agents/info";
    params: {
        agentId?: string;
    };
} | {
    method: "agents/list";
    params?: {
        filter?: Record<string, string>;
    };
};
export interface A2AResponse {
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}
export interface A2AClientConfig {
    timeout?: number;
    headers?: Record<string, string>;
}
export interface TaskHandle {
    taskId: string;
    status: TaskStatus;
}
export interface A2AAgentConfig {
    name: string;
    description: string;
    url: string;
    version: string;
    skills?: Skill[];
    capabilities?: Partial<AgentCapabilities>;
    port?: number;
}
//# sourceMappingURL=types.d.ts.map
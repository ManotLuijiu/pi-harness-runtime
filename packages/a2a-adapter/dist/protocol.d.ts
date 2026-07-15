/**
 * A2A Adapter — Protocol Constants (RFC-0069)
 */
export declare const A2A_PROTOCOL_VERSION = "1.0.0";
export declare const A2A_CONTENT_TYPE = "application/json";
export declare const HTTP_METHODS: {
    readonly GET: "GET";
    readonly POST: "POST";
};
export declare const WELL_KNOWN_AGENT_PATH = "/.well-known/agent.json";
export declare const STATUS: {
    readonly SUBMITTED: "submitted";
    readonly WORKING: "working";
    readonly COMPLETED: "completed";
    readonly CANCELED: "canceled";
    readonly FAILED: "failed";
};
export declare const ERROR_CODES: {
    readonly INVALID_REQUEST: -32600;
    readonly METHOD_NOT_FOUND: -32601;
    readonly INVALID_PARAMS: -32602;
    readonly INTERNAL_ERROR: -32603;
    readonly TASK_NOT_FOUND: 40401;
    readonly TASK_STATE: 40402;
};
/**
 * Serialize task as SSE event
 */
export declare function formatSSETaskEvent(event: string, data: unknown): string;
/**
 * Parse agent card from well-known URL
 */
export declare function wellKnownAgentUrl(baseUrl: string): string;
//# sourceMappingURL=protocol.d.ts.map
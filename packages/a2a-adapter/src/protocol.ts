/**
 * A2A Adapter — Protocol Constants (RFC-0069)
 */

export const A2A_PROTOCOL_VERSION = "1.0.0";
export const A2A_CONTENT_TYPE = "application/json";

export const HTTP_METHODS = {
	GET: "GET",
	POST: "POST",
} as const;

export const WELL_KNOWN_AGENT_PATH = "/.well-known/agent.json";

// Status codes
export const STATUS = {
	SUBMITTED: "submitted",
	WORKING: "working",
	COMPLETED: "completed",
	CANCELED: "canceled",
	FAILED: "failed",
} as const;

// Error codes
export const ERROR_CODES = {
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	TASK_NOT_FOUND: 40401,
	TASK_STATE: 40402,
} as const;

/**
 * Serialize task as SSE event
 */
export function formatSSETaskEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse agent card from well-known URL
 */
export function wellKnownAgentUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/$/, "")}${WELL_KNOWN_AGENT_PATH}`;
}

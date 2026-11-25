/**
 * The tools of the reverse bridge.
 *
 * The bridge speaks MCP over stdio. The tools are the four ways a worker
 * of another vendor talks to a live Pi session:
 *
 * - `agent_list`: the live instances and their identity,
 * - `agent_send`: a message for one instance,
 * - `agent_result`: the replies of an exchange,
 * - `agent_cancel`: a message that shall not be delivered.
 *
 * The result of a tool is JSON in the text of the answer: a worker reads
 * it, and a human reads it too.
 */

import {
	cancelMessage,
	isBridgeAction,
	listAgents,
	readResult,
	sendToAgent,
	type BridgeOptions,
} from "./bridge.js";
import type { BridgeSendInput } from "./types.js";

/**
 * One tool of the bridge.
 */
export interface BridgeTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/**
 * The tools of the bridge.
 */
export const BRIDGE_TOOLS: BridgeTool[] = [
	{
		name: "agent_list",
		description:
			"List the live Pi instances that may be addressed: their agent id, session id, generation, workspace, host and whether they are busy.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "agent_send",
		description:
			"Send a message to a live Pi instance. The message names the instance it is for. The result is 'accepted' when the message is in the mailbox of the instance, and 'deferred' when the instance is busy.",
		inputSchema: {
			type: "object",
			properties: {
				agentId: {
					type: "string",
					description:
						"The agent id of the instance. Without it the bridge only sends when exactly one instance of the workspace is live.",
				},
				sessionId: {
					type: "string",
					description: "The session of the instance, when it is known.",
				},
				generation: {
					type: "number",
					description: "The generation of the instance, when it is known.",
				},
				action: {
					type: "string",
					enum: ["inform", "review", "implement"],
					description: "What the message asks for.",
				},
				summary: {
					type: "string",
					description: "The summary of the message, for a human and for a notification.",
				},
				payload: {
					type: "string",
					description: "The body of the message.",
				},
				reference: {
					type: "string",
					description: "A file of the workspace the message points at.",
				},
				paths: {
					type: "array",
					items: { type: "string" },
					description: "The paths inside the workspace the action may touch.",
				},
				correlationId: {
					type: "string",
					description: "The id of the exchange, when the caller wants to follow it.",
				},
			},
			required: ["action", "summary"],
			additionalProperties: false,
		},
	},
	{
		name: "agent_result",
		description:
			"Read the result of an exchange: whether the instance took the message, whether it finished, and the replies of the exchange.",
		inputSchema: {
			type: "object",
			properties: {
				correlationId: {
					type: "string",
					description: "The id of the exchange.",
				},
			},
			required: ["correlationId"],
			additionalProperties: false,
		},
	},
	{
		name: "agent_cancel",
		description:
			"Cancel a message that was sent but not delivered yet. A message that was delivered already is not cancelled.",
		inputSchema: {
			type: "object",
			properties: {
				agentId: {
					type: "string",
					description: "The agent id of the instance the message was sent to.",
				},
				messageId: {
					type: "string",
					description: "The id of the message.",
				},
				correlationId: {
					type: "string",
					description: "The id of the exchange, when the message id is not known.",
				},
			},
			required: ["agentId"],
			additionalProperties: false,
		},
	},
];

/**
 * The answer of a tool.
 */
export interface BridgeToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

/**
 * The answer of a tool, with JSON in it.
 */
function answer(value: unknown, isError = false): BridgeToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		...(isError ? { isError: true } : {}),
	};
}

/**
 * The input of a message, read from the arguments of the tool.
 *
 * The arguments come from the worker, so every field is checked before it
 * is used: an argument that is not a string is not a string, and an
 * action that is not one of the three is not an action.
 */
export function readSendInput(args: Record<string, unknown>): BridgeSendInput {
	const action = isBridgeAction(args.action) ? args.action : "inform";
	const paths = Array.isArray(args.paths)
		? args.paths.filter((path): path is string => typeof path === "string")
		: undefined;
	const input: BridgeSendInput = {
		action,
		summary: typeof args.summary === "string" ? args.summary : "",
	};
	if (typeof args.agentId === "string") input.agentId = args.agentId;
	if (typeof args.sessionId === "string") input.sessionId = args.sessionId;
	if (typeof args.generation === "number") input.generation = args.generation;
	if (typeof args.payload === "string") input.payload = args.payload;
	if (typeof args.reference === "string") input.reference = args.reference;
	if (typeof args.correlationId === "string") input.correlationId = args.correlationId;
	if (paths && paths.length > 0) input.paths = paths;
	return input;
}

/**
 * Run one tool of the bridge.
 */
export function callBridgeTool(
	options: BridgeOptions,
	name: string,
	args: Record<string, unknown> = {},
): BridgeToolResult {
	switch (name) {
		case "agent_list": {
			return answer({ agents: listAgents(options) });
		}
		case "agent_send": {
			const result = sendToAgent(options, readSendInput(args));
			return answer(result, result.status === "refused");
		}
		case "agent_result": {
			const correlationId = String(args.correlationId ?? "");
			const result = readResult(options, correlationId);
			return answer(result, result.status === "unknown");
		}
		case "agent_cancel": {
			const result = cancelMessage(options, {
				agentId: String(args.agentId ?? ""),
				messageId: args.messageId ? String(args.messageId) : undefined,
				correlationId: args.correlationId
					? String(args.correlationId)
					: undefined,
			});
			return answer(result, result.status !== "cancelled");
		}
		default:
			return answer({ error: `unknown tool: ${name}` }, true);
	}
}

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
import { type BridgeOptions } from "./bridge.js";
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
export declare const BRIDGE_TOOLS: BridgeTool[];
/**
 * The answer of a tool.
 */
export interface BridgeToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}
/**
 * The input of a message, read from the arguments of the tool.
 *
 * The arguments come from the worker, so every field is checked before it
 * is used: an argument that is not a string is not a string, and an
 * action that is not one of the three is not an action.
 */
export declare function readSendInput(args: Record<string, unknown>): BridgeSendInput;
/**
 * Run one tool of the bridge.
 */
export declare function callBridgeTool(options: BridgeOptions, name: string, args?: Record<string, unknown>): BridgeToolResult;
//# sourceMappingURL=tools.d.ts.map
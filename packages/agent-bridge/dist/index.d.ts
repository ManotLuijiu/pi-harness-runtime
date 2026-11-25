/**
 * The reverse bridge between a worker of another vendor and a Pi session.
 *
 * The bridge lets Codex or Claude Code address a session of this machine:
 * the worker sends a message into the mailbox of the session, and it reads
 * the answer of the session as the replies of the exchange.
 *
 * The package holds the rules of the routing and the MCP server that
 * speaks them:
 *
 * - `bridge.ts`: the live instances, the selection of the instance of a
 *   message, the send, the result and the cancel,
 * - `tools.ts`: the four tools of the bridge,
 * - `server.ts`: the MCP server over stdio,
 * - `cli.ts`: the entry point the worker starts.
 *
 * The rules never decide by a model label and never by the globally
 * newest session: a message names the instance it is for, and an instance
 * that is not live any more never receives it.
 */
export { BRIDGE_HOME, cancelMessage, isBridgeAction, listAgents, readResult, sendToAgent, } from "./bridge.js";
export type { BridgeOptions } from "./bridge.js";
export { BRIDGE_TOOLS, callBridgeTool, readSendInput, } from "./tools.js";
export type { BridgeTool, BridgeToolResult } from "./tools.js";
export { handleBridgeRequest, readLines, runBridgeServer } from "./server.js";
export type { BridgeAction, BridgeAgent, BridgeCancelResult, BridgeIdentity, BridgeReply, BridgeResult, BridgeResultStatus, BridgeSendInput, BridgeSendResult, } from "./types.js";
//# sourceMappingURL=index.d.ts.map
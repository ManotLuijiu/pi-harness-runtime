/**
 * The MCP server of the reverse bridge.
 *
 * The server speaks MCP over stdio: it reads the requests of the worker
 * of another vendor from stdin and writes the answers to stdout. The
 * worker may then address a live Pi session with the four tools of the
 * bridge.
 *
 * The server holds no state of its own: every tool reads the state of the
 * user from the files of the plan handoff. A second worker that starts
 * its own server sees the same sessions.
 */
import type { BridgeOptions } from "./bridge.js";
/**
 * The lines of a chunk, and the buffer that is left.
 *
 * A worker that never ends its line does not grow the buffer of the
 * server without a bound: the request is refused and the buffer starts
 * again.
 */
export declare function readLines(buffer: string, chunk: string): {
    lines: string[];
    buffer: string;
    overflow: boolean;
};
/**
 * A request of the worker.
 */
interface BridgeRequest {
    jsonrpc: "2.0";
    id?: number | string | null;
    method: string;
    params?: Record<string, unknown>;
}
/**
 * An answer of the server.
 */
interface BridgeResponse {
    jsonrpc: "2.0";
    id: number | string | null;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}
/**
 * Answer one request.
 */
export declare function handleBridgeRequest(options: BridgeOptions, request: BridgeRequest): BridgeResponse | null;
/**
 * Run the server on the standard streams.
 *
 * The server reads the requests line by line: the worker of another vendor
 * writes one JSON object per line.
 */
export declare function runBridgeServer(options: BridgeOptions): void;
export {};
//# sourceMappingURL=server.d.ts.map
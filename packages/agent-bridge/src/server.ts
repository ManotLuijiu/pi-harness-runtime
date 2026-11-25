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

import {
	BRIDGE_TOOLS,
	callBridgeTool,
	type BridgeToolResult,
} from "./tools.js";
import type { BridgeOptions } from "./bridge.js";

/**
 * The protocol version the server speaks.
 */
const PROTOCOL_VERSION = "2024-11-05";

/**
 * The largest request the server reads.
 */
const MAX_REQUEST_BYTES = 1_000_000;

/**
 * The lines of a chunk, and the buffer that is left.
 *
 * A worker that never ends its line does not grow the buffer of the
 * server without a bound: the request is refused and the buffer starts
 * again.
 */
export function readLines(
	buffer: string,
	chunk: string,
): { lines: string[]; buffer: string; overflow: boolean } {
	const joined = buffer + chunk;
	if (joined.length > MAX_REQUEST_BYTES) {
		return { lines: [], buffer: "", overflow: true };
	}
	const parts = joined.split("\n");
	return {
		lines: parts.slice(0, -1),
		buffer: parts[parts.length - 1] ?? "",
		overflow: false,
	};
}

/**
 * The name of the server.
 */
const SERVER_NAME = "pi-agent-bridge";

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
	error?: { code: number; message: string };
}

/**
 * The error of a request that failed.
 */
function failure(id: number | string | null, code: number, message: string): BridgeResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Answer one request.
 */
export function handleBridgeRequest(
	options: BridgeOptions,
	request: BridgeRequest,
): BridgeResponse | null {
	const id = request.id ?? null;
	if (request.method === "initialize") {
		return {
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: SERVER_NAME, version: "1" },
			},
		};
	}
	if (request.method === "notifications/initialized") return null;
	if (request.method === "ping") return { jsonrpc: "2.0", id, result: {} };
	if (request.method === "tools/list") {
		return { jsonrpc: "2.0", id, result: { tools: BRIDGE_TOOLS } };
	}
	if (request.method === "tools/call") {
		const name = request.params?.name;
		if (typeof name !== "string") {
			return failure(id, -32602, "the call has no tool name");
		}
		const args = request.params?.arguments;
		const argumentsOfCall =
			typeof args === "object" && args !== null
				? (args as Record<string, unknown>)
				: {};
		let result: BridgeToolResult;
		try {
			result = callBridgeTool(options, name, argumentsOfCall);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return failure(id, -32603, message);
		}
		return { jsonrpc: "2.0", id, result };
	}
	return failure(id, -32601, `unknown method: ${request.method}`);
}

/**
 * Run the server on the standard streams.
 *
 * The server reads the requests line by line: the worker of another vendor
 * writes one JSON object per line.
 */
export function runBridgeServer(options: BridgeOptions): void {
	let buffer = "";
	process.stdin.setEncoding("utf8");

	const answer = (response: BridgeResponse | null): void => {
		if (!response) return;
		process.stdout.write(`${JSON.stringify(response)}\n`);
	};

	process.stdin.on("data", (chunk: string) => {
		const read = readLines(buffer, chunk);
		buffer = read.buffer;
		if (read.overflow) {
			answer(failure(null, -32600, "the request is larger than the server reads"));
			return;
		}
		for (const line of read.lines) {
			if (!line.trim()) continue;
			try {
				const request = JSON.parse(line) as BridgeRequest;
				answer(handleBridgeRequest(options, request));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				answer(failure(null, -32700, `the request is not JSON: ${message}`));
			}
		}
	});

	process.stdin.on("end", () => {
		if (!buffer.trim()) return;
		try {
			const request = JSON.parse(buffer) as BridgeRequest;
			answer(handleBridgeRequest(options, request));
		} catch {
			// A last line that is not JSON is not answered: the worker is
			// gone, and nothing waits for the answer.
		}
	});
}

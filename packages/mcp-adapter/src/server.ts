/**
 * MCP Adapter — STDIO Server (RFC-0068)
 *
 * Implements MCP Protocol 2024-11-05 over STDIO.
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 */

import { HARNESS_TOOLS } from "./tools.js";
import type {
	MCPRequest,
	MCPResponse,
	MCPServerOptions,
	InitializeResult,
	MCPResource,
	MCPPrompt,
	ToolCallParams,
} from "./types.js";

let initialized = false;

export async function createMCPServer(
	options: MCPServerOptions = {},
): Promise<void> {
	const serverName = options.name ?? "pi-harness";
	const serverVersion = options.version ?? "0.9.4";
	const protocolVersion = "2024-11-05" as const;

	// Read JSON-RPC requests from stdin
	let buffer = "";
	process.stdin.setEncoding("utf-8");

	process.stdin.on("data", async (chunk: string) => {
		buffer += chunk;

		// Split on newlines (JSON-RPC messages)
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const request = JSON.parse(line) as MCPRequest;
				const response = handleRequestSync(
					request,
					serverName,
					serverVersion,
					protocolVersion,
				);
				if (response) {
					process.stdout.write(JSON.stringify(response) + "\n");
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Parse error";
				const errorResponse: MCPResponse = {
					jsonrpc: "2.0",
					id: 0,
					error: { code: -32700, message: msg },
				};
				process.stdout.write(JSON.stringify(errorResponse) + "\n");
			}
		}
	});

	process.stdin.on("end", () => {
		if (buffer.trim()) {
			try {
				const request = JSON.parse(buffer) as MCPRequest;
				const response = handleRequestSync(
					request,
					serverName,
					serverVersion,
					protocolVersion,
				);
				if (response) {
					process.stdout.write(JSON.stringify(response) + "\n");
				}
			} catch {
				// ignore
			}
		}
	});
}

function handleRequestSync(
	req: MCPRequest,
	serverName: string,
	serverVersion: string,
	protocolVersion: string,
): MCPResponse | null {
	const { method, id } = req;

	// Initialize — must be first
	if (method === "initialize") {
		initialized = true;
		const result: InitializeResult = {
			protocolVersion: protocolVersion as InitializeResult["protocolVersion"],
			capabilities: {
				tools: { listChanged: false },
				resources: { subscribe: false, listChanged: false },
				prompts: { listChanged: false },
			},
			serverInfo: { name: serverName, version: serverVersion },
		};
		return { jsonrpc: "2.0", id, result };
	}

	// Every request after initialize needs initialized notification
	if (!initialized && method !== "initialize") {
		return {
			jsonrpc: "2.0",
			id,
			error: { code: -32602, message: "Server not initialized" },
		};
	}

	switch (method) {
		case "tools/list": {
			const result = { tools: HARNESS_TOOLS };
			return { jsonrpc: "2.0", id, result };
		}

		case "tools/call": {
			const params = req.params as unknown as ToolCallParams;
			if (!params.name) {
				return {
					jsonrpc: "2.0",
					id,
					error: { code: -32602, message: "Missing tool name" },
				};
			}
			const result = handleToolCallSync(params.name, params.arguments);
			return { jsonrpc: "2.0", id, result };
		}

		case "resources/list": {
			const resources: MCPResource[] = [
				{
					uri: "harness://skills",
					name: "Harness Skills",
					description: "List of all registered skills",
				},
				{
					uri: "harness://capabilities",
					name: "Capabilities",
					description: "Current capability registry",
				},
			];
			const result = { resources };
			return { jsonrpc: "2.0", id, result };
		}

		case "prompts/list": {
			const prompts: MCPPrompt[] = [
				{
					name: "analyze_project",
					description: "Full project analysis with recommendations",
				},
				{
					name: "review_code",
					description: "Code review with context from workspace",
				},
			];
			const result = { prompts };
			return { jsonrpc: "2.0", id, result };
		}

		case "ping": {
			return { jsonrpc: "2.0", id, result: null };
		}

		default:
			return {
				jsonrpc: "2.0",
				id,
				error: { code: -32601, message: `Method not found: ${method}` },
			};
	}
}

/** Synchronous tool call wrapper (tool handlers are sync for MCP) */
function handleToolCallSync(
	toolName: string,
	args?: Record<string, unknown>,
): { content: Array<{ type: string; text: string }>; isError?: boolean } {
	try {
		switch (toolName) {
			case "analyze_workspace": {
				const { path } = (args ?? {}) as { path: string };
				const fs = require("fs");
				if (!fs.existsSync(path)) {
					return {
						content: [{ type: "text", text: `Path does not exist: ${path}` }],
						isError: true,
					};
				}
				const files = fs.readdirSync(path);
				const frameworks: string[] = [];
				if (files.includes("package.json")) frameworks.push("node");
				if (files.includes("go.mod")) frameworks.push("go");
				if (
					files.includes("pyproject.toml") ||
					files.includes("requirements.txt")
				)
					frameworks.push("python");
				if (files.includes("composer.json")) frameworks.push("php");
				if (
					files.includes("next.config.js") ||
					files.includes("next.config.ts")
				)
					frameworks.push("nextjs");
				if (files.includes("vite.config.ts")) frameworks.push("react-vite");
				if (files.includes("manage.py")) frameworks.push("django");
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{ path, frameworks, fileCount: files.length },
								null,
								2,
							),
						},
					],
				};
			}
			case "search_memory":
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								query: (args as { query: string })?.query,
								results: [],
								note: "Stub — integrate with memory-engine at runtime",
							}),
						},
					],
				};
			case "list_skills":
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								skills: [],
								note: "Stub — integrate with skill-registry at runtime",
							}),
						},
					],
				};
			case "invoke_skill":
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								skill: (args as { name: string })?.name,
								note: "Stub — integrate with skill-registry at runtime",
							}),
						},
					],
				};
			default:
				return {
					content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
					isError: true,
				};
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { content: [{ type: "text", text: msg }], isError: true };
	}
}

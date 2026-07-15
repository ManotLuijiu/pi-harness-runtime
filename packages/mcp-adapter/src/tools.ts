/// <reference types="node" />

/**
 * MCP Adapter — Tool Definitions (RFC-0068)
 *
 * Exposes 4 core harness capabilities as MCP tools.
 */

import type { MCPTool, ToolCallResult } from "./types.js";

export const HARNESS_TOOLS: MCPTool[] = [
	{
		name: "analyze_workspace",
		description:
			"Analyze a codebase directory to detect framework, structure, and dependencies",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute path to workspace directory",
				},
				framework: {
					type: "string",
					description: "Force specific framework detection",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_memory",
		description:
			"Search the harness persistent memory store for relevant knowledge",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				limit: { type: "number", description: "Max results (default: 5)" },
			},
			required: ["query"],
		},
	},
	{
		name: "list_skills",
		description:
			"List all registered harness skills with their triggers and capabilities",
		inputSchema: {
			type: "object",
			properties: {
				capability: {
					type: "string",
					description: "Filter by capability type",
				},
			},
		},
	},
	{
		name: "invoke_skill",
		description: "Invoke a named harness skill with a trigger",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Skill name to invoke" },
				trigger: {
					type: "object",
					description: "Trigger object with type and value",
					properties: {
						type: { type: "string", enum: ["keyword", "intent", "pattern"] },
						value: { type: "string" },
						confidence: { type: "number" },
					},
					required: ["type", "value"],
				},
				context: { type: "object", description: "Optional context overrides" },
			},
			required: ["name", "trigger"],
		},
	},
];

/**
 * Tool handler function — maps MCP tool name to harness capability
 */
export async function handleToolCall(
	toolName: string,
	args?: Record<string, unknown>,
): Promise<ToolCallResult> {
	try {
		switch (toolName) {
			case "analyze_workspace":
				return handleAnalyzeWorkspace(args as unknown as AnalyzeArgs);
			case "search_memory":
				return handleSearchMemory(args as unknown as SearchArgs);
			case "list_skills":
				return handleListSkills(args as unknown as ListSkillsArgs);
			case "invoke_skill":
				return handleInvokeSkill(args as unknown as InvokeSkillArgs);
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

interface AnalyzeArgs {
	path: string;
	framework?: string;
}
interface SearchArgs {
	query: string;
	limit?: number;
}
interface ListSkillsArgs {
	capability?: string;
}
interface InvokeSkillArgs {
	name: string;
	trigger: { type: string; value: string; confidence?: number };
	context?: Record<string, unknown>;
}

async function handleAnalyzeWorkspace(
	args: AnalyzeArgs,
): Promise<ToolCallResult> {
	const { path } = args;
	const fs = await import("node:fs");
	const pathModule = await import("node:path");

	if (!fs.existsSync(path)) {
		return {
			content: [{ type: "text", text: `Path does not exist: ${path}` }],
			isError: true,
		};
	}

	// Basic framework detection from filesystem
	const files = fs.readdirSync(path);
	const frameworks: string[] = [];
	if (files.includes("package.json")) frameworks.push("node");
	if (files.includes("go.mod")) frameworks.push("go");
	if (files.includes("Cargo.toml")) frameworks.push("rust");
	if (files.includes("pyproject.toml") || files.includes("requirements.txt"))
		frameworks.push("python");
	if (files.includes("composer.json")) frameworks.push("php");
	if (
		files.includes("frappe-bench") ||
		fs.existsSync(pathModule.join(path, "sites"))
	) {
		frameworks.push("frappe");
	}
	if (files.includes("next.config.js") || files.includes("next.config.ts"))
		frameworks.push("nextjs");
	if (files.includes("vite.config.ts")) frameworks.push("react-vite");
	if (files.includes("manage.py")) frameworks.push("django");

	const result = JSON.stringify(
		{ path, frameworks, fileCount: files.length },
		null,
		2,
	);
	return { content: [{ type: "text", text: result }] };
}

async function handleSearchMemory(args: SearchArgs): Promise<ToolCallResult> {
	const { query, limit = 5 } = args;
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					query,
					limit,
					results: [],
					note: "Memory search requires runtime integration",
				}),
			},
		],
	};
}

async function handleListSkills(args: ListSkillsArgs): Promise<ToolCallResult> {
	const { capability } = args;
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					capability,
					skills: [],
					note: "Skill registry requires runtime integration",
				}),
			},
		],
	};
}

async function handleInvokeSkill(
	args: InvokeSkillArgs,
): Promise<ToolCallResult> {
	const { name, trigger, context } = args;
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					skill: name,
					trigger,
					context,
					note: "Skill invocation requires runtime integration",
				}),
			},
		],
	};
}

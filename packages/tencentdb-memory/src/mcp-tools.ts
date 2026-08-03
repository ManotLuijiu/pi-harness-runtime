/**
 * MCP Tools for TencentDB Memory (RFC-0105)
 *
 * Provides MCP tools for agents to query centralized skills.
 */

import type {
	MCPTool,
	MCPToolCall,
	ToolCallResult,
	TencentDBConfig,
	SearchRequest,
} from "./types.js";
import { TencentDBMemoryClient } from "./client.js";
import { loadSkillsFromDirectories } from "./loader.js";

// --- Tool Definitions ----------------------------------------------------------

export function getTencentDBTools(config: TencentDBConfig): MCPTool[] {
	return [
		{
			name: "tencentdb_search_skills",
			description:
				"Search skills from centralized knowledge base. Use when you need to find relevant skills or procedures for a task.",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search query text",
					},
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Filter by tags (optional)",
					},
					limit: {
						type: "number",
						description: "Maximum results (default: 5)",
					},
				},
				required: ["query"],
			},
		},
		{
			name: "tencentdb_sync_skills",
			description:
				"Sync local skills directory to centralized server. Use when local skills have been updated.",
			inputSchema: {
				type: "object",
				properties: {
					directories: {
						type: "array",
						items: { type: "string" },
						description:
							"List of directories containing SKILL.md files",
					},
					force: {
						type: "boolean",
						description: "Force sync (ignore timestamp check)",
					},
				},
				required: ["directories"],
			},
		},
		{
			name: "tencentdb_list_skills",
			description: "List all available skills from centralized knowledge base.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
		{
			name: "tencentdb_health",
			description: "Check if TencentDB Memory server is healthy.",
			inputSchema: {
				type: "object",
				properties: {},
			},
		},
	];
}

// --- Tool Handler -------------------------------------------------------------

export class TencentDBToolHandler {
	private client: TencentDBMemoryClient;
	private localDirs?: string[];

	constructor(config: TencentDBConfig) {
		this.client = new TencentDBMemoryClient(config);
	}

	/**
	 * Set local directories for sync
	 */
	setLocalDirectories(dirs: string[]): void {
		this.localDirs = dirs;
	}

	/**
	 * Handle tool call
	 */
	async handleToolCall(call: MCPToolCall): Promise<ToolCallResult> {
		try {
			switch (call.name) {
				case "tencentdb_search_skills": {
					const args = call.arguments as Partial<SearchRequest>;
					const results = await this.client.searchSkills({
						query: args.query || "",
						tags: args.tags,
						limit: args.limit || 5,
						includeDetails: true,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(results, null, 2),
							},
						],
					};
				}

				case "tencentdb_sync_skills": {
					const args = call.arguments as {
						directories?: string[];
						force?: boolean;
					};
					const dirs = args.directories || this.localDirs || [];
					if (dirs.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											error: "No directories specified",
										},
										null,
										2,
									),
								},
							],
							isError: true,
						};
					}
					const skills = loadSkillsFromDirectories(dirs);
					const result = await this.client.syncSkills({
						skills,
						force: args.force,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case "tencentdb_list_skills": {
					const skills = await this.client.listSkills();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(skills, null, 2),
							},
						],
					};
				}

				case "tencentdb_health": {
					const health = await this.client.health();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(health, null, 2),
							},
						],
					};
				}

				default:
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
							},
						],
						isError: true,
					};
			}
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							error: error instanceof Error ? error.message : String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
}

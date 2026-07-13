/**
 * Master Planner — RFC-0017
 *
 * Converts a human requirement into an executable task graph.
 * Uses a planning LLM to decompose the requirement into tasks with dependencies.
 */

import type { TaskGraph } from "../packages/types/src/runtime-types.ts";
import type { TaskGraphManager } from "./task-graph.ts";

export interface PlanResult {
	success: boolean;
	graph?: TaskGraph;
	error?: string;
}

export interface PlannerOptions {
	planningProvider?: {
		call: (prompt: string, systemPrompt: string) => Promise<string>;
	};
	maxTasks?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a software project planner. Given a human requirement, decompose it into a clear task list.

Rules:
1. Each task should be atomic and independently testable
2. Tasks must be ordered with proper dependencies
3. Include acceptance criteria for each task
4. Consider: analysis, implementation, testing, review phases
5. Output ONLY valid JSON in the specified format

Output format:
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Descriptive title",
      "description": "What this task does",
      "dependencies": [], // array of task IDs this depends on
      "acceptanceCriteria": ["criterion 1", "criterion 2"]
    }
  ]
}`;

export class MasterPlanner {
	constructor(private readonly options: PlannerOptions = {}) {}

	/**
	 * Create a plan from a requirement
	 */
	async createPlan(
		requirement: string,
		jobId: string,
		rootDir: string,
	): Promise<PlanResult> {
		try {
			// Build the planning prompt
			const userPrompt = `Human requirement:\n${requirement}\n\nMax tasks: ${this.options.maxTasks ?? 20}`;

			let taskList: {
				id: string;
				title: string;
				description: string;
				dependencies: string[];
				acceptanceCriteria?: string[];
			}[];

			if (this.options.planningProvider) {
				// Use LLM to generate task list
				const response = await this.options.planningProvider.call(
					userPrompt,
					DEFAULT_SYSTEM_PROMPT,
				);
				const parsed = this.parsePlanningResponse(response);
				if (!parsed) {
					return { success: false, error: "Failed to parse planning response" };
				}
				taskList = parsed;
			} else {
				// Use heuristic planner for simple requirements
				taskList = this.heuristicPlan(requirement);
			}

			// Validate the task list
			if (taskList.length === 0) {
				return { success: false, error: "No tasks generated from requirement" };
			}

			// Validate dependencies (no cycles, all deps exist)
			const taskIds = new Set(taskList.map((t) => t.id));
			for (const task of taskList) {
				for (const dep of task.dependencies) {
					if (!taskIds.has(dep)) {
						return {
							success: false,
							error: `Task ${task.id} has invalid dependency: ${dep}`,
						};
					}
				}
			}

			// Create task graph
			const graphManager = new TaskGraphManager({ jobId });

			for (const task of taskList) {
				graphManager.addTask(
					task.id,
					task.title,
					task.description,
					task.dependencies,
					task.acceptanceCriteria,
				);
			}

			const graph = graphManager.getGraph();

			// Save the graph
			await graphManager.save(rootDir);

			return { success: true, graph };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Parse planning response from LLM
	 */
	private parsePlanningResponse(
		response: string,
	):
		| {
				id: string;
				title: string;
				description: string;
				dependencies: string[];
				acceptanceCriteria?: string[];
		  }[]
		| null {
		// Try to extract JSON from response
		const jsonMatch =
			response.match(/```json\n([\s\S]*?)\n```/) ??
			response.match(/\{[\s\S]*"tasks"[\s\S]*\}/);

		if (!jsonMatch) {
			console.error("Failed to extract JSON from planning response");
			return null;
		}

		const jsonStr = jsonMatch[1] ?? jsonMatch[0];

		try {
			const parsed = JSON.parse(jsonStr);
			return parsed.tasks ?? [];
		} catch {
			console.error("Failed to parse JSON from planning response");
			return null;
		}
	}

	/**
	 * Heuristic planner for simple requirements
	 * Used when no LLM provider is available
	 */
	heuristicPlan(
		requirement: string,
	): {
		id: string;
		title: string;
		description: string;
		dependencies: string[];
		acceptanceCriteria?: string[];
	}[] {
		const tasks: {
			id: string;
			title: string;
			description: string;
			dependencies: string[];
			acceptanceCriteria?: string[];
		}[] = [];
		const req = requirement.toLowerCase();

		// Task 1: Analysis
		tasks.push({
			id: "task-001",
			title: "Analyze requirements",
			description: `Analyze and document the requirements: ${requirement}`,
			dependencies: [],
			acceptanceCriteria: [
				"Requirements are clearly documented",
				"All edge cases identified",
				"Technical approach defined",
			],
		});

		// Task 2: Implementation
		if (
			req.includes("api") ||
			req.includes("endpoint") ||
			req.includes("backend")
		) {
			tasks.push({
				id: "task-002",
				title: "Implement API endpoints",
				description: "Create API endpoints based on requirements",
				dependencies: ["task-001"],
				acceptanceCriteria: [
					"Endpoints return correct responses",
					"Error handling implemented",
					"Input validation in place",
				],
			});
		}

		if (
			req.includes("database") ||
			req.includes("model") ||
			req.includes("schema")
		) {
			tasks.push({
				id: "task-003",
				title: "Implement database schema",
				description: "Create database models and migrations",
				dependencies: ["task-001"],
				acceptanceCriteria: [
					"Schema matches requirements",
					"Migrations run successfully",
					"Relationships defined correctly",
				],
			});
		}

		if (
			req.includes("ui") ||
			req.includes("frontend") ||
			req.includes("page") ||
			req.includes("component")
		) {
			tasks.push({
				id: "task-004",
				title: "Implement UI components",
				description: "Create frontend UI components",
				dependencies: ["task-001"],
				acceptanceCriteria: [
					"Components match design",
					"Responsive on all devices",
					"Accessible",
				],
			});
		}

		// Task 5: Tests
		const implDeps = tasks
			.filter((t) => t.id.startsWith("task-00"))
			.map((t) => t.id);
		tasks.push({
			id: "task-010",
			title: "Write unit tests",
			description: "Write unit tests for all implemented code",
			dependencies: implDeps.length > 0 ? implDeps : ["task-001"],
			acceptanceCriteria: [
				"All new code has >80% test coverage",
				"All tests pass",
				"Edge cases covered",
			],
		});

		// Task 6: Integration
		tasks.push({
			id: "task-011",
			title: "Integration testing",
			description: "Run integration tests and verify end-to-end flow",
			dependencies: ["task-010"],
			acceptanceCriteria: [
				"Integration tests pass",
				"No regression in existing functionality",
			],
		});

		// Task 7: Review
		tasks.push({
			id: "task-012",
			title: "Code review",
			description: "Review code for quality, security, and best practices",
			dependencies: ["task-011"],
			acceptanceCriteria: [
				"Code follows project style guide",
				"No security vulnerabilities",
				"Documentation updated",
			],
		});

		return tasks;
	}

	/**
	 * Generate a simple task ID
	 */
	static generateTaskId(index: number): string {
		return `task-${String(index).padStart(3, "0")}`;
	}
}

/**
 * Parse a requirement into a basic task list (synchronous, no LLM)
 */
export function parseRequirementIntoTasks(
	requirement: string,
	jobId: string,
): TaskGraphManager {
	const planner = new MasterPlanner();
	const taskList = planner.heuristicPlan(requirement);

	const graphManager = new TaskGraphManager({ jobId });
	for (const task of taskList) {
		graphManager.addTask(
			task.id,
			task.title,
			task.description,
			task.dependencies,
			task.acceptanceCriteria,
		);
	}

	return graphManager;
}

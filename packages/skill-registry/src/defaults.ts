/**
 * Default Skill Definitions (RFC-0052)
 */

import type { Skill } from "./types.js";
import { createKeywordTrigger, createIntentTrigger } from "./matching.js";

/**
 * Introspection skill - lists all registered skills
 */
const introspectSkill: Skill = {
	id: "skill-registry-introspect",
	name: "Introspect Skill Registry",
	description: "Lists all registered skills and their triggers",
	version: "1.0.0",
	trigger: createKeywordTrigger(["list skills", "show skills", "what skills"]),
	handler: async (context) => {
		const registry = context.metadata.registry as
			| { list(): Skill[] }
			| undefined;
		if (!registry || typeof registry.list !== "function") {
			return { success: false, error: "Registry not available in context" };
		}
		const skills = registry.list();
		const summary = skills
			.map((s) => `- ${s.name} (${s.id}): ${s.description}`)
			.join("\n");
		return {
			success: true,
			output: `Registered Skills:\n${summary}`,
			metadata: { count: skills.length },
		};
	},
	metadata: {
		tags: ["meta", "debug", "introspection"],
		examples: ["list skills", "show me all skills"],
	},
};

/**
 * Help skill - provides help about available commands
 */
const helpSkill: Skill = {
	id: "skill-help",
	name: "Help Assistant",
	description: "Provides help and guidance for using the runtime",
	version: "1.0.0",
	trigger: createKeywordTrigger(["help", "how to", "what is"]),
	handler: async () => {
		const taskDescription = "";
		return {
			success: true,
			output: `Available commands and skills:\n- Type "list skills" to see all skills\n- Use standard agent commands for file operations\n- Ask for help on specific topics`,
			metadata: { context: taskDescription },
		};
	},
	metadata: {
		tags: ["help", "documentation"],
		examples: ["help me", "how do I", "what is this"],
	},
};

/**
 * Status skill - shows runtime status
 */
const statusSkill: Skill = {
	id: "skill-status",
	name: "Runtime Status",
	description: "Shows current runtime status and statistics",
	version: "1.0.0",
	trigger: createIntentTrigger(["status", "health", "stats", "statistics"]),
	handler: async () => {
		return {
			success: true,
			output: "Runtime Status: Active\nAll systems operational",
			metadata: {
				timestamp: Date.now(),
				uptime: Math.round(Date.now() / 1000),
			},
		};
	},
	metadata: {
		tags: ["status", "monitoring"],
		examples: ["check status", "show stats"],
	},
};

export const DEFAULT_SKILLS: Skill[] = [
	introspectSkill,
	helpSkill,
	statusSkill,
];

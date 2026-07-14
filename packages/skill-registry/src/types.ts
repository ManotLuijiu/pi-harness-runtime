/**
 * Skill Registry Types (RFC-0052)
 */

// ─── Trigger Types ─────────────────────────────────────────────────────

export type TriggerType = "keyword" | "pattern" | "intent" | "tool_request";

export interface SkillTrigger {
	type: TriggerType;
	value: string | string[];
	confidence?: number;
}

// ─── Skill Types ──────────────────────────────────────────────────────

export interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface SkillContext {
	messages: Array<{
		role: "user" | "assistant" | "system";
		content: string;
	}>;
	task?: {
		id: string;
		title: string;
		description: string;
	};
	requirement?: {
		id: string;
		description: string;
	};
	tools: Array<{
		name: string;
		description?: string;
	}>;
	metadata: Record<string, unknown>;
}

export interface SkillResult {
	success: boolean;
	output?: string;
	toolCalls?: ToolCall[];
	error?: string;
	metadata?: Record<string, unknown>;
}

export type SkillHandler = (context: SkillContext) => Promise<SkillResult>;

export interface SkillMetadata {
	author?: string;
	tags: string[];
	examples?: string[];
	requiresCapabilities?: string[];
	deprecated?: boolean;
}

export interface Skill {
	id: string;
	name: string;
	description: string;
	version: string;
	trigger: SkillTrigger;
	handler: SkillHandler;
	metadata: SkillMetadata;
}

// ─── Registry Types ────────────────────────────────────────────────────

export interface SkillRegistry {
	register(skill: Skill): void;
	unregister(skillId: string): void;
	get(skillId: string): Skill | undefined;
	list(): Skill[];
	find(trigger: { type: TriggerType; value: string }): Skill[];
	invoke(skillId: string, context: SkillContext): Promise<SkillResult>;
	invokeBestMatch(
		trigger: SkillTrigger,
		context: SkillContext,
	): Promise<SkillResult>;
}

// ─── Event Types ─────────────────────────────────────────────────────

export type SkillRegistryEvent =
	| { type: "skill.registered"; skillId: string; name: string }
	| { type: "skill.unregistered"; skillId: string }
	| {
			type: "skill.invoked";
			skillId: string;
			success: boolean;
			duration: number;
	  }
	| { type: "skill.error"; skillId: string; error: string };

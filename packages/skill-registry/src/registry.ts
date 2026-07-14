/**
 * Skill Registry Implementation (RFC-0052)
 */

import type {
	Skill,
	SkillContext,
	SkillResult,
	SkillRegistryEvent,
	SkillTrigger,
	TriggerType,
} from "./types.js";
import { DEFAULT_SKILLS } from "./defaults.js";
import { findBestMatch, findAllMatches } from "./matching.js";

type EventHandler = (event: SkillRegistryEvent) => void;

/**
 * In-memory skill registry with event emission
 */
export class InMemorySkillRegistry {
	private skills: Map<string, Skill> = new Map();
	private eventHandlers: Set<EventHandler> = new Set();

	constructor(loadDefaults = true) {
		if (loadDefaults) {
			this.loadDefaults();
		}
	}

	/**
	 * Load default skills
	 */
	private loadDefaults(): void {
		for (const skill of DEFAULT_SKILLS) {
			this.register(skill);
		}
	}

	/**
	 * Register a skill
	 */
	register(skill: Skill): void {
		if (skill.metadata.deprecated) {
			return; // Don't register deprecated skills
		}
		this.skills.set(skill.id, skill);
		this.emit({
			type: "skill.registered",
			skillId: skill.id,
			name: skill.name,
		});
	}

	/**
	 * Unregister a skill
	 */
	unregister(skillId: string): void {
		if (this.skills.has(skillId)) {
			this.skills.delete(skillId);
			this.emit({
				type: "skill.unregistered",
				skillId,
			});
		}
	}

	/**
	 * Get a skill by ID
	 */
	get(skillId: string): Skill | undefined {
		return this.skills.get(skillId);
	}

	/**
	 * List all skills
	 */
	list(): Skill[] {
		return Array.from(this.skills.values());
	}

	/**
	 * Find skills matching a trigger
	 */
	find(trigger: { type: TriggerType; value: string }): Skill[] {
		const all = this.list();

		// Filter by type first
		const matchingType = all.filter((s) => s.trigger.type === trigger.type);

		// Then score
		const scored = findAllMatches(matchingType, trigger.value);
		return scored.map((s) => s.skill);
	}

	/**
	 * Invoke a skill by ID
	 */
	async invoke(skillId: string, context: SkillContext): Promise<SkillResult> {
		const skill = this.skills.get(skillId);
		if (!skill) {
			return { success: false, error: `Skill not found: ${skillId}` };
		}

		const startTime = Date.now();
		try {
			const result = await skill.handler(context);
			this.emit({
				type: "skill.invoked",
				skillId,
				success: result.success,
				duration: Date.now() - startTime,
			});
			return result;
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this.emit({
				type: "skill.error",
				skillId,
				error,
			});
			return { success: false, error };
		}
	}

	/**
	 * Invoke the best matching skill for a trigger (RFC-0052)
	 *
	 * Uses trigger.confidence as minConfidence threshold per RFC spec:
	 * "Best match returns highest-scoring skill above confidence threshold."
	 */
	async invokeBestMatch(
		trigger: SkillTrigger,
		context: SkillContext,
	): Promise<SkillResult> {
		const all = this.list();

		// Filter by type first
		const matching = all.filter((s) => s.trigger.type === trigger.type);

		// Use trigger.confidence as min threshold, fallback to 0.5
		const minConfidence = trigger.confidence ?? 0.5;
		const bestMatch = findBestMatch(
			matching,
			trigger.value as string,
			minConfidence,
		);

		if (!bestMatch) {
			return {
				success: false,
				error: "No matching skill found",
			};
		}

		// Capability check (RFC-0052: "requiresCapabilities in metadata")
		if (bestMatch.metadata.requiresCapabilities?.length) {
			const capabilityRegistry = context.metadata.capabilityRegistry as
				| { has(cap: string): boolean }
				| undefined;

			if (!capabilityRegistry) {
				return {
					success: false,
					error: `Skill "${bestMatch.name}" requires capabilities ${JSON.stringify(bestMatch.metadata.requiresCapabilities)} but no capability registry is available`,
				};
			}

			for (const cap of bestMatch.metadata.requiresCapabilities) {
				if (!capabilityRegistry.has(cap)) {
					return {
						success: false,
						error: `Skill "${bestMatch.name}" requires capability "${cap}" which is not available`,
					};
				}
			}
		}

		return this.invoke(bestMatch.id, context);
	}

	/**
	 * Subscribe to events
	 */
	onEvent(handler: EventHandler): () => void {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}

	/**
	 * Emit an event
	 */
	private emit(event: SkillRegistryEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors
			}
		}
	}
}

/**
 * Create a new skill registry
 */
export function createSkillRegistry(
	loadDefaults = true,
): InMemorySkillRegistry {
	return new InMemorySkillRegistry(loadDefaults);
}

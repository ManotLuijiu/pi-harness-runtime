/**
 * Skill Registry Implementation (RFC-0052)
 */
import type { Skill, SkillContext, SkillResult, SkillRegistryEvent, TriggerType } from "./types.js";
type EventHandler = (event: SkillRegistryEvent) => void;
/**
 * In-memory skill registry with event emission
 */
export declare class InMemorySkillRegistry {
    private skills;
    private eventHandlers;
    constructor(loadDefaults?: boolean);
    /**
     * Load default skills
     */
    private loadDefaults;
    /**
     * Register a skill
     */
    register(skill: Skill): void;
    /**
     * Unregister a skill
     */
    unregister(skillId: string): void;
    /**
     * Get a skill by ID
     */
    get(skillId: string): Skill | undefined;
    /**
     * List all skills
     */
    list(): Skill[];
    /**
     * Find skills matching a trigger
     */
    find(trigger: {
        type: TriggerType;
        value: string;
    }): Skill[];
    /**
     * Invoke a skill by ID
     */
    invoke(skillId: string, context: SkillContext): Promise<SkillResult>;
    /**
     * Invoke the best matching skill for a trigger
     */
    invokeBestMatch(trigger: {
        type: TriggerType;
        value: string;
    }, context: SkillContext): Promise<SkillResult>;
    /**
     * Subscribe to events
     */
    onEvent(handler: EventHandler): () => void;
    /**
     * Emit an event
     */
    private emit;
}
/**
 * Create a new skill registry
 */
export declare function createSkillRegistry(loadDefaults?: boolean): InMemorySkillRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map
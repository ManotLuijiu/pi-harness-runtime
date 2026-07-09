/**
 * Code Generation Pipeline - Template Registry
 *
 * Registry for managing templates.
 */
import type { Template, TemplateSet, RegistryQuery, RegistryEntry } from "../types.js";
export declare class TemplateRegistry {
    private templates;
    private sets;
    /**
     * Register a template
     */
    register(template: Template): void;
    /**
     * Register multiple templates
     */
    registerAll(templates: Template[]): void;
    /**
     * Register a template set
     */
    registerSet(set: TemplateSet): void;
    /**
     * Get a template by ID
     */
    get(id: string): Template | undefined;
    /**
     * Get a template set by ID
     */
    getSet(id: string): TemplateSet | undefined;
    /**
     * List all templates
     */
    list(): Template[];
    /**
     * List all template sets
     */
    listSets(): TemplateSet[];
    /**
     * Query templates
     */
    query(query: RegistryQuery): Template[];
    /**
     * List entries (templates and sets)
     */
    listEntries(): RegistryEntry[];
    /**
     * Remove a template
     */
    remove(id: string): boolean;
    /**
     * Remove a template set
     */
    removeSet(id: string): boolean;
    /**
     * Clear all templates
     */
    clear(): void;
    /**
     * Get template count
     */
    size(): number;
}
//# sourceMappingURL=registry.d.ts.map
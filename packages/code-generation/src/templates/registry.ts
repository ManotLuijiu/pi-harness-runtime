/**
 * Code Generation Pipeline - Template Registry
 *
 * Registry for managing templates.
 */

import type {
	RegistryEntry,
	RegistryQuery,
	Template,
	TemplateSet,
} from "../types.js";

// ─── Template Registry ────────────────────────────────────────────────────

export class TemplateRegistry {
	private templates: Map<string, Template> = new Map();
	private sets: Map<string, TemplateSet> = new Map();

	/**
	 * Register a template
	 */
	register(template: Template): void {
		this.templates.set(template.id, template);
	}

	/**
	 * Register multiple templates
	 */
	registerAll(templates: Template[]): void {
		for (const template of templates) {
			this.register(template);
		}
	}

	/**
	 * Register a template set
	 */
	registerSet(set: TemplateSet): void {
		this.sets.set(set.id, set);
		for (const template of set.templates) {
			this.register(template);
		}
	}

	/**
	 * Get a template by ID
	 */
	get(id: string): Template | undefined {
		return this.templates.get(id);
	}

	/**
	 * Get a template set by ID
	 */
	getSet(id: string): TemplateSet | undefined {
		return this.sets.get(id);
	}

	/**
	 * List all templates
	 */
	list(): Template[] {
		return Array.from(this.templates.values());
	}

	/**
	 * List all template sets
	 */
	listSets(): TemplateSet[] {
		return Array.from(this.sets.values());
	}

	/**
	 * Query templates
	 */
	query(query: RegistryQuery): Template[] {
		let results = this.list();

		// Filter by tags
		if (query.tags && query.tags.length > 0) {
			results = results.filter((t) =>
				t.tags?.some((tag) => query.tags?.includes(tag)),
			);
		}

		// Filter by language
		if (query.language) {
			results = results.filter((t) => t.language === query.language);
		}

		// Search by name/description
		if (query.search) {
			const searchLower = query.search.toLowerCase();
			results = results.filter(
				(t) =>
					t.name.toLowerCase().includes(searchLower) ||
					t.description.toLowerCase().includes(searchLower),
			);
		}

		// Apply limit
		if (query.limit && query.limit > 0) {
			results = results.slice(0, query.limit);
		}

		return results;
	}

	/**
	 * List entries (templates and sets)
	 */
	listEntries(): RegistryEntry[] {
		const entries: RegistryEntry[] = [];

		for (const template of this.templates.values()) {
			entries.push({
				id: template.id,
				type: "template",
				name: template.name,
				tags: template.tags ?? [],
				createdAt: template.createdAt,
			});
		}

		for (const set of this.sets.values()) {
			entries.push({
				id: set.id,
				type: "template-set",
				name: set.name,
				tags: [],
				createdAt:
					(set.metadata?.createdAt as string) ?? new Date().toISOString(),
			});
		}

		return entries;
	}

	/**
	 * Remove a template
	 */
	remove(id: string): boolean {
		return this.templates.delete(id);
	}

	/**
	 * Remove a template set
	 */
	removeSet(id: string): boolean {
		const set = this.sets.get(id);
		if (set) {
			for (const template of set.templates) {
				this.templates.delete(template.id);
			}
		}
		return this.sets.delete(id);
	}

	/**
	 * Clear all templates
	 */
	clear(): void {
		this.templates.clear();
		this.sets.clear();
	}

	/**
	 * Get template count
	 */
	size(): number {
		return this.templates.size;
	}
}

/**
 * Skill Registry
 * 
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Skill,
  SkillIndex,
  SkillIndexEntry,
  MatchOptions,
  MatchResult,
  LoadOptions,
  LoadedSkill,
  DEFAULT_SKILLS_CONFIG,
} from "./types.js";
import { parseSkillFile, scanSkillDirectory } from "./parser.js";

/**
 * Skill Registry - manages loaded and indexed skills
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private index: SkillIndex = { entries: [], loadedAt: 0 };
  private loading: Map<string, Promise<Skill>> = new Map();

  /**
   * Register a skill
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
    this.updateIndex(skill);
  }

  /**
   * Unregister a skill by ID
   */
  unregister(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (skill) {
      this.skills.delete(skillId);
      this.index.entries = this.index.entries.filter(
        (e) => e.id !== skillId
      );
      return true;
    }
    return false;
  }

  /**
   * Get a skill by ID
   */
  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * List all registered skills
   */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill index (lightweight)
   */
  getIndex(): SkillIndex {
    return this.index;
  }

  /**
   * Find skills matching a trigger/query
   */
  find(query: string, options?: MatchOptions): MatchResult[] {
    const results: MatchResult[] = [];
    const threshold = options?.threshold ?? 0.3;
    const queryLower = query.toLowerCase();

    for (const skill of this.skills.values()) {
      // Skip disabled skills if requested
      if (
        !options?.includeDisabled &&
        skill.frontmatter.disable_model_invocation
      ) {
        continue;
      }

      let score = 0;
      const matchedTriggers: string[] = [];

      // Check name match
      if (skill.id.toLowerCase().includes(queryLower)) {
        score += 0.8;
        matchedTriggers.push(`name:${skill.id}`);
      }

      // Check description match
      if (skill.frontmatter.description.toLowerCase().includes(queryLower)) {
        score += 0.5;
        matchedTriggers.push("description");
      }

      // Check triggers
      if (skill.hermes?.triggers) {
        for (const trigger of skill.hermes.triggers) {
          if (trigger.toLowerCase().includes(queryLower)) {
            score += 0.9;
            matchedTriggers.push(`trigger:${trigger}`);
          }
          // Also check regex-style triggers
          try {
            const regex = new RegExp(trigger, "i");
            if (regex.test(query)) {
              score += 0.9;
              matchedTriggers.push(`regex:${trigger}`);
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }

      // Check tags
      if (skill.hermes?.anti_patterns) {
        for (const anti of skill.hermes.anti_patterns) {
          if (anti.toLowerCase().includes(queryLower)) {
            score += 0.3;
            matchedTriggers.push("anti-pattern");
          }
        }
      }

      // Usage bonus
      if (skill.hermes?.usage_count && skill.hermes.usage_count > 0) {
        score += Math.min(0.2, skill.hermes.usage_count * 0.01);
      }

      if (score >= threshold) {
        results.push({ skill, score, matchedTriggers });
      }
    }

    // Sort results
    const sortBy = options?.sortBy ?? "score";
    results.sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "usage") {
        const aUsage = a.skill.hermes?.usage_count ?? 0;
        const bUsage = b.skill.hermes?.usage_count ?? 0;
        return bUsage - aUsage;
      }
      return a.skill.id.localeCompare(b.skill.id);
    });

    return results;
  }

  /**
   * Find best matching skill for a query
   */
  findBestMatch(query: string, options?: MatchOptions): MatchResult | null {
    const results = this.find(query, { ...options, threshold: 0 });
    return results[0] ?? null;
  }

  /**
   * Load a skill's full content (progressive disclosure)
   */
  async load(skillId: string, options?: LoadOptions): Promise<LoadedSkill | null> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return null;
    }

    // If already loaded, return cached
    if (skill.loaded && !options?.loadReferences && !options?.loadExamples) {
      return skill as LoadedSkill;
    }

    // Check if already loading
    if (this.loading.has(skillId)) {
      return this.loading.get(skillId) as Promise<Skill>;
    }

    // Load the skill
    const loadPromise = this.loadSkill(skill, options);
    this.loading.set(skillId, loadPromise);

    try {
      const loadedSkill = await loadPromise;
      this.loading.delete(skillId);
      return loadedSkill;
    } catch (err) {
      this.loading.delete(skillId);
      throw err;
    }
  }

  /**
   * Load skill content from disk
   */
  private async loadSkill(
    skill: Skill,
    options?: LoadOptions
  ): Promise<LoadedSkill> {
    const loadedSkill: LoadedSkill = { ...skill };
    const skillMdPath = join(skill.path, "SKILL.md");

    // Re-parse to get fresh content
    if (existsSync(skillMdPath)) {
      const parsed = parseSkillFile(skillMdPath);
      loadedSkill.body = parsed.body;
      loadedSkill.frontmatter = parsed.frontmatter;
      loadedSkill.hermes = parsed.hermes;
    }

    // Load references if requested
    if (options?.loadReferences) {
      loadedSkill.referencesContent = new Map();
      for (const ref of skill.references) {
        if (existsSync(ref.path)) {
          try {
            const content = readFileSync(ref.path, "utf-8");
            loadedSkill.referencesContent.set(ref.name, content);
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    // Load examples if requested
    if (options?.loadExamples) {
      loadedSkill.examplesContent = new Map();
      for (const example of skill.examples) {
        if (existsSync(example.path)) {
          try {
            const content = readFileSync(example.path, "utf-8");
            loadedSkill.examplesContent.set(example.name, content);
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    // Mark as loaded
    loadedSkill.loaded = true;
    loadedSkill.lastUsed = Date.now();

    // Update usage count
    if (loadedSkill.hermes) {
      loadedSkill.hermes.usage_count =
        (loadedSkill.hermes.usage_count ?? 0) + 1;
    }

    // Update in registry
    this.skills.set(skill.id, loadedSkill);

    return loadedSkill;
  }

  /**
   * Update skill index entry
   */
  private updateIndex(skill: Skill): void {
    // Remove existing entry if present
    this.index.entries = this.index.entries.filter(
      (e) => e.id !== skill.id
    );

    // Add new entry
    this.index.entries.push({
      id: skill.id,
      name: skill.frontmatter.name,
      description: skill.frontmatter.description,
      path: skill.path,
      version: skill.frontmatter.version,
      triggers: skill.hermes?.triggers,
      loaded: skill.loaded,
    });

    // Update load time
    this.index.loadedAt = Date.now();
  }

  /**
   * Clear all skills
   */
  clear(): void {
    this.skills.clear();
    this.index = { entries: [], loadedAt: 0 };
    this.loading.clear();
  }

  /**
   * Get count of registered skills
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Check if skill exists
   */
  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }
}

/**
 * Create a new skill registry
 */
export function createSkillRegistry(): SkillRegistry {
  return new SkillRegistry();
}

/**
 * Global skill registry instance (singleton)
 */
let globalRegistry: SkillRegistry | null = null;

export function getGlobalSkillRegistry(): SkillRegistry {
  if (!globalRegistry) {
    globalRegistry = createSkillRegistry();
  }
  return globalRegistry;
}

export function setGlobalSkillRegistry(registry: SkillRegistry): void {
  globalRegistry = registry;
}

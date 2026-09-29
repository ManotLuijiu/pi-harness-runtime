/**
 * Curator - Consolidation and Quality Enforcement
 * 
 * Periodic pass that:
 * - Merges fragmented memory into skills
 * - Extracts common patterns into skills
 * - Prunes outdated items
 * - Enforces quality standards
 * 
 * Based on Hermes Agent's curator system.
 */

import type { Trajectory } from "./types.js";
import type { MemoryEntry } from "./memory-store.js";

/**
 * Local Skill type to avoid circular dependency
 */
interface LocalSkill {
  id: string;
  frontmatter: { name: string; description: string };
  hermes?: {
    author?: string;
    created_at?: string;
    usage_count?: number;
  };
}

/**
 * Local lint result type
 */
interface LocalLintResult {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
}

/**
 * Curator configuration
 */
export interface CuratorConfig {
  /** Enable curator */
  enabled: boolean;
  /** Days between consolidation passes */
  consolidationIntervalDays: number;
  /** Max memory entries before consolidation */
  memoryThreshold: number;
  /** Min similar entries to trigger merge */
  similarityThreshold: number;
  /** Archive skills older than this */
  archiveAgeDays: number;
}

/**
 * Default curator configuration
 */
export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  enabled: true,
  consolidationIntervalDays: 7,
  memoryThreshold: 50,
  similarityThreshold: 3,
  archiveAgeDays: 90,
};

/**
 * Curator action types
 */
export type CuratorAction =
  | { type: "merge_memory"; entries: MemoryEntry[]; into: string }
  | { type: "extract_skill"; pattern: string; from: string[] }
  | { type: "archive_memory"; id: string }
  | { type: "archive_skill"; id: string }
  | { type: "patch_skill"; id: string; patch: Partial<LocalSkill> }
  | { type: "prune_low_confidence"; items: { id: string; type: "memory" | "skill"; confidence: number }[] };

/**
 * Curator event types
 */
export type CuratorEvent =
  | { type: "curator.started" }
  | { type: "curator.completed"; actions: CuratorAction[] }
  | { type: "curator.action"; action: CuratorAction }
  | { type: "curator.error"; error: string };

/**
 * Curator event handler
 */
export type CuratorEventHandler = (event: CuratorEvent) => void;

/**
 * Similarity result
 */
export interface SimilarityResult {
  entries: MemoryEntry[];
  similarity: number; // 0-1
  commonTheme: string;
}

/**
 * Curator class
 */
export class Curator {
  private config: CuratorConfig;
  private handlers: Set<CuratorEventHandler> = new Set();
  private lastConsolidation: number = Date.now();

  constructor(config?: Partial<CuratorConfig>) {
    this.config = { ...DEFAULT_CURATOR_CONFIG, ...config };
  }

  /**
   * Register event handler
   */
  on(handler: CuratorEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Emit event
   */
  private emit(event: CuratorEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[Curator] Handler error:", err);
      }
    }
  }

  /**
   * Check if consolidation should run
   */
  shouldConsolidate(): boolean {
    if (!this.config.enabled) return false;

    const daysSinceConsolidation =
      (Date.now() - this.lastConsolidation) / (1000 * 60 * 60 * 24);

    return daysSinceConsolidation >= this.config.consolidationIntervalDays;
  }

  /**
   * Run consolidation pass
   */
  async consolidate(
    memory: MemoryEntry[],
    skills: LocalSkill[],
    trajectories: Trajectory[]
  ): Promise<CuratorAction[]> {
    this.emit({ type: "curator.started" });
    const actions: CuratorAction[] = [];

    try {
      // 1. Find similar memory entries
      const similarGroups = this.findSimilarMemory(memory);
      for (const group of similarGroups) {
        if (group.entries.length >= this.config.similarityThreshold) {
          const action = this.suggestMerge(group);
          if (action) {
            actions.push(action);
            this.emit({ type: "curator.action", action });
          }
        }
      }

      // 2. Extract patterns from trajectories
      const patterns = this.extractPatterns(trajectories);
      for (const pattern of patterns) {
        const action = this.suggestSkillExtraction(pattern);
        if (action) {
          actions.push(action);
          this.emit({ type: "curator.action", action });
        }
      }

      // 3. Check for outdated items
      const outdated = this.findOutdatedItems(memory, skills);
      for (const item of outdated) {
        const action = this.suggestArchive(item);
        if (action) {
          actions.push(action);
          this.emit({ type: "curator.action", action });
        }
      }

      // 4. Lint skills for quality
      for (const skill of skills) {
        const results: LocalLintResult[] = []; // Linting would require skills package
        const errors: LocalLintResult[] = results.filter((r) => r.severity === "error");
        if (errors.length > 0) {
          // Suggest patch to fix errors
          const action = this.suggestSkillPatch(skill, errors);
          if (action) {
            actions.push(action);
            this.emit({ type: "curator.action", action });
          }
        }
      }

      // Update last consolidation time
      this.lastConsolidation = Date.now();

      this.emit({ type: "curator.completed", actions });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: "curator.error", error: errorMsg });
    }

    return actions;
  }

  /**
   * Find similar memory entries
   */
  findSimilarMemory(memory: MemoryEntry[]): SimilarityResult[] {
    const groups: Map<string, MemoryEntry[]> = new Map();

    for (const entry of memory) {
      // Extract key terms from content
      const terms = this.extractTerms(entry.content);
      
      for (const term of terms) {
        const key = term.toLowerCase();
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(entry);
      }
    }

    // Filter to groups with multiple entries
    const results: SimilarityResult[] = [];
    for (const [theme, entries] of groups) {
      // Deduplicate entries
      const unique = Array.from(new Set(entries.map((e) => e.id)))
        .map((id) => entries.find((e) => e.id === id)!);

      if (unique.length >= 2) {
        results.push({
          entries: unique,
          similarity: Math.min(1, unique.length / 10),
          commonTheme: theme,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results;
  }

  /**
   * Extract key terms from content
   */
  private extractTerms(content: string): string[] {
    // Simple term extraction
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);

    // Get most common words
    const freq: Record<string, number> = {};
    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    // Return top terms
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  /**
   * Suggest memory merge
   */
  private suggestMerge(group: SimilarityResult): CuratorAction | null {
    // Find the most recent/relevant entry to keep
    const keeper = group.entries.reduce((a, b) =>
      a.updated_at > b.updated_at ? a : b
    );

    return {
      type: "merge_memory",
      entries: group.entries.filter((e) => e.id !== keeper.id),
      into: keeper.id,
    };
  }

  /**
   * Extract patterns from trajectories
   */
  extractPatterns(trajectories: Trajectory[]): string[] {
    const patterns: string[] = [];

    // Group by verdict
    const byVerdict: Record<string, Trajectory[]> = {};
    for (const t of trajectories) {
      if (!byVerdict[t.verdict]) {
        byVerdict[t.verdict] = [];
      }
      byVerdict[t.verdict].push(t);
    }

    // Find converged patterns (approved with low iterations)
    const fastConverged = trajectories.filter(
      (t) => t.verdict === "approved" && t.iterations <= 2
    );

    for (const t of fastConverged) {
      const taskType = this.categorizeTask(t.taskRequest);
      patterns.push(`fast-${taskType}`);
    }

    // Find stuck patterns (high iterations)
    const stuck = trajectories.filter(
      (t) => t.iterations >= 5 && t.verdict !== "approved"
    );

    for (const t of stuck) {
      const taskType = this.categorizeTask(t.taskRequest);
      patterns.push(`stuck-${taskType}`);
    }

    return [...new Set(patterns)];
  }

  /**
   * Categorize task from request
   */
  private categorizeTask(request: string): string {
    const lower = request.toLowerCase();

    if (lower.includes("test")) return "testing";
    if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
    if (lower.includes("refactor")) return "refactor";
    if (lower.includes("api")) return "api";
    if (lower.includes("config") || lower.includes("setup")) return "config";

    return "general";
  }

  /**
   * Suggest skill extraction
   */
  private suggestSkillExtraction(pattern: string): CuratorAction | null {
    return {
      type: "extract_skill",
      pattern,
      from: [], // Would be populated from trajectories
    };
  }

  /**
   * Find outdated items
   */
  findOutdatedItems(
    memory: MemoryEntry[],
    skills: LocalSkill[]
  ): Array<{ id: string; type: "memory" | "skill"; ageDays: number }> {
    const outdated: Array<{ id: string; type: "memory" | "skill"; ageDays: number }> = [];
    const now = Date.now();

    for (const entry of memory) {
      const ageMs = now - new Date(entry.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > this.config.archiveAgeDays) {
        outdated.push({ id: entry.id, type: "memory", ageDays });
      }
    }

    for (const skill of skills) {
      const created = skill.hermes?.created_at
        ? new Date(skill.hermes.created_at).getTime()
        : now;
      const ageMs = now - created;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      // Only archive agent-created skills, not user skills
      if (ageDays > this.config.archiveAgeDays && skill.hermes?.author === "agent") {
        const usageCount = skill.hermes?.usage_count ?? 0;
        if (usageCount === 0) {
          outdated.push({ id: skill.id, type: "skill", ageDays });
        }
      }
    }

    return outdated;
  }

  /**
   * Suggest archive action
   */
  private suggestArchive(
    item: { id: string; type: "memory" | "skill"; ageDays: number }
  ): CuratorAction {
    return {
      type: item.type === "memory" ? "archive_memory" : "archive_skill",
      id: item.id,
    } as CuratorAction;
  }

  /**
   * Suggest skill patch
   */
  private suggestSkillPatch(
    skill: LocalSkill,
    errors: Array<{ rule: string; message: string }>
  ): CuratorAction {
    // Generate patch suggestion based on errors
    const patches: Partial<LocalSkill> = {};

    for (const error of errors) {
      switch (error.rule) {
        case "missing-description":
          // Would need to generate a description
          break;
        case "oversized-body":
          // Would need to suggest splitting
          break;
        case "incident-log-shape":
          // Would need to clean up content
          break;
      }
    }

    return {
      type: "patch_skill",
      id: skill.id,
      patch: patches,
    };
  }

  /**
   * Get quality summary
   */
  getQualitySummary(skills: LocalSkill[]): {
    total: number;
    errors: number;
    warnings: number;
    byRule: Record<string, number>;
  } {
    // Note: Full linting requires skills package - returning placeholder
    return {
      total: skills.length,
      errors: 0,
      warnings: 0,
      byRule: {},
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CuratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): CuratorConfig {
    return { ...this.config };
  }
}

// Global instance
let globalCurator: Curator | null = null;

export function getGlobalCurator(): Curator {
  if (!globalCurator) {
    globalCurator = new Curator();
  }
  return globalCurator;
}

export function createCurator(config?: Partial<CuratorConfig>): Curator {
  return new Curator(config);
}

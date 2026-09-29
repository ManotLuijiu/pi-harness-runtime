/**
 * Skill Versioning
 * 
 * Track skill changes, store diff history, support rollback.
 * Based on Hermes Agent's skill versioning.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Skill version entry
 */
export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  createdAt: string;
  author: "agent" | "user" | "curator";
  changes: SkillChanges;
  content: string;
  message?: string;
}

/**
 * Skill changes (diff summary)
 */
export interface SkillChanges {
  frontmatter?: {
    added?: Record<string, unknown>;
    removed?: Record<string, unknown>;
    changed?: Record<string, { from: unknown; to: unknown }>;
  };
  body?: {
    linesAdded: number;
    linesRemoved: number;
    summary: string;
  };
  references?: {
    added: string[];
    removed: string[];
  };
}

/**
 * Skill versioning store
 */
export interface SkillVersioningStore {
  versions: SkillVersion[];
  currentVersion: string;
}

/**
 * Skill versioning configuration
 */
export interface SkillVersioningConfig {
  /** Enable versioning */
  enabled: boolean;
  /** Directory for version storage */
  versionsDir: string;
  /** Max versions to keep per skill */
  maxVersions: number;
}

/**
 * Default configuration
 */
export const DEFAULT_VERSIONING_CONFIG: SkillVersioningConfig = {
  enabled: true,
  versionsDir: "~/.pi-harness/skill-versions",
  maxVersions: 50,
};

/**
 * Expand path with ~
 */
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Generate changes summary
 */
function generateChanges(oldContent: string, newContent: string): SkillChanges {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Simple line diff
  let linesAdded = 0;
  let linesRemoved = 0;

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const line of newLines) {
    if (!oldSet.has(line)) {
      linesAdded++;
    }
  }

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      linesRemoved++;
    }
  }

  // Generate summary
  let summary = "";
  if (linesAdded > 0 && linesRemoved > 0) {
    summary = `Modified ${linesAdded} lines, removed ${linesRemoved}`;
  } else if (linesAdded > 0) {
    summary = `Added ${linesAdded} lines`;
  } else if (linesRemoved > 0) {
    summary = `Removed ${linesRemoved} lines`;
  } else {
    summary = "Minor changes";
  }

  return {
    body: {
      linesAdded,
      linesRemoved,
      summary,
    },
  };
}

/**
 * Skill versioning class
 */
export class SkillVersioning {
  private config: SkillVersioningConfig;
  private versionsDir: string;
  private cache: Map<string, SkillVersion[]> = new Map();

  constructor(config?: Partial<SkillVersioningConfig>) {
    this.config = { ...DEFAULT_VERSIONING_CONFIG, ...config };
    this.versionsDir = expandPath(this.config.versionsDir);
    mkdirSync(this.versionsDir, { recursive: true });
  }

  /**
   * Record a new version
   */
  recordVersion(
    skillId: string,
    content: string,
    author: "agent" | "user" | "curator" = "agent",
    message?: string
  ): SkillVersion {
    // Get current version number
    const versions = this.getVersions(skillId);
    const lastVersion = versions[0];
    const lastVersionNum = lastVersion
      ? parseInt(lastVersion.version.split(".")[2] || "0", 10)
      : 0;
    const newVersion = `1.0.${lastVersionNum + 1}`;

    // Generate changes
    const changes = lastVersion
      ? generateChanges(lastVersion.content, content)
      : { body: { linesAdded: content.split("\n").length, linesRemoved: 0, summary: "Initial version" } };

    const version: SkillVersion = {
      id: `${skillId}_v${Date.now()}`,
      skillId,
      version: newVersion,
      createdAt: new Date().toISOString(),
      author,
      changes,
      content,
      message,
    };

    // Add to cache and save
    versions.unshift(version);
    this.cache.set(skillId, versions);
    this.saveVersion(skillId, versions);

    // Trim old versions
    this.trimVersions(skillId);

    return version;
  }

  /**
   * Get versions for a skill
   */
  getVersions(skillId: string): SkillVersion[] {
    if (this.cache.has(skillId)) {
      return this.cache.get(skillId)!;
    }

    const filePath = join(this.versionsDir, `${skillId}.json`);
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const versions = JSON.parse(content) as SkillVersion[];
      this.cache.set(skillId, versions);
      return versions;
    } catch (err) {
      console.error(`[SkillVersioning] Failed to load ${filePath}:`, err);
      return [];
    }
  }

  /**
   * Get specific version
   */
  getVersion(skillId: string, version: string): SkillVersion | null {
    const versions = this.getVersions(skillId);
    return versions.find((v) => v.version === version) ?? null;
  }

  /**
   * Get latest version
   */
  getLatestVersion(skillId: string): SkillVersion | null {
    const versions = this.getVersions(skillId);
    return versions[0] ?? null;
  }

  /**
   * Rollback to previous version
   */
  rollback(skillId: string, targetVersion: string): SkillVersion | null {
    const version = this.getVersion(skillId, targetVersion);
    if (!version) {
      return null;
    }

    // Record the rollback as a new version
    return this.recordVersion(
      skillId,
      version.content,
      "user",
      `Rolled back to version ${targetVersion}`
    );
  }

  /**
   * Get diff between versions
   */
  getDiff(skillId: string, fromVersion: string, toVersion: string): {
    from: SkillVersion | null;
    to: SkillVersion | null;
    changes: SkillChanges | null;
  } {
    const from = this.getVersion(skillId, fromVersion);
    const to = this.getVersion(skillId, toVersion);

    if (!from || !to) {
      return { from: null, to: null, changes: null };
    }

    const changes = generateChanges(from.content, to.content);
    return { from, to, changes };
  }

  /**
   * Save version to disk
   */
  private saveVersion(skillId: string, versions: SkillVersion[]): void {
    const filePath = join(this.versionsDir, `${skillId}.json`);
    try {
      writeFileSync(filePath, JSON.stringify(versions, null, 2), "utf-8");
    } catch (err) {
      console.error(`[SkillVersioning] Failed to save ${filePath}:`, err);
    }
  }

  /**
   * Trim old versions
   */
  private trimVersions(skillId: string): void {
    const versions = this.cache.get(skillId);
    if (!versions || versions.length <= this.config.maxVersions) {
      return;
    }

    const trimmed = versions.slice(0, this.config.maxVersions);
    this.cache.set(skillId, trimmed);
    this.saveVersion(skillId, trimmed);
  }

  /**
   * List all skills with versions
   */
  listSkills(): string[] {
    try {
      const { readdirSync } = require("node:fs");
      const files = readdirSync(this.versionsDir);
      return files
        .filter((f: string) => f.endsWith(".json"))
        .map((f: string) => f.replace(".json", ""));
    } catch (err) {
      return [];
    }
  }

  /**
   * Get version history summary
   */
  getHistorySummary(skillId: string): {
    totalVersions: number;
    authors: Record<string, number>;
    lastModified: string | null;
  } {
    const versions = this.getVersions(skillId);
    const authors: Record<string, number> = {};

    for (const v of versions) {
      authors[v.author] = (authors[v.author] || 0) + 1;
    }

    return {
      totalVersions: versions.length,
      authors,
      lastModified: versions[0]?.createdAt ?? null,
    };
  }
}

// Global instance
let globalVersioning: SkillVersioning | null = null;

export function getGlobalSkillVersioning(): SkillVersioning {
  if (!globalVersioning) {
    globalVersioning = new SkillVersioning();
  }
  return globalVersioning;
}

export function createSkillVersioning(
  config?: Partial<SkillVersioningConfig>
): SkillVersioning {
  return new SkillVersioning(config);
}

/**
 * PolicyLoader - Loads and hashes harness and scoped project rules.
 *
 * Responsibilities:
 * - Load the immutable harness policy shipped with the package
 * - Walk from project root toward target file collecting scoped AGENTS.md
 * - Normalize newlines and paths, then hash the ordered mandatory content
 * - Build a PolicyManifest with source paths, scope, priority, and hashes
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { PolicyManifest, PolicySource } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Supported rule file names in priority order.
 * Earlier names have higher priority.
 */
const RULE_FILE_NAMES = [
  "AGENTS.md",      // Mandatory, harness or project
  "RULES.md",       // Advisory
  "PROJECT_RULES.md", // Advisory
  "CLAUDE.md",      // Advisory
  "CONTRIBUTING.md", // Advisory (only if explicitly trusted)
] as const;

/**
 * Maximum walk depth to prevent infinite loops.
 */
const MAX_WALK_DEPTH = 20;

/**
 * Files that indicate project trust.
 */
const TRUST_INDICATORS = [".git", "package.json", "Cargo.toml", "go.mod"] as const;

// ---------------------------------------------------------------------------
// PolicyLoader
// ---------------------------------------------------------------------------

/**
 * Policy loader configuration.
 */
export interface PolicyLoaderConfig {
  /** Path to the harness-owned AGENTS.md */
  harnessRulesPath: URL;
  /** Optional additional harness rule files */
  additionalRulesPaths?: URL[];
}

/**
 * Loads and processes agent policies from harness and project sources.
 */
export class PolicyLoader {
  private harnessRulesPath: URL;
  private additionalRulesPaths: URL[];
  private cache: Map<string, { manifest: PolicyManifest; cachedAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 5000; // 5 second cache for same-cwd loads

  constructor(config: PolicyLoaderConfig) {
    this.harnessRulesPath = config.harnessRulesPath;
    this.additionalRulesPaths = config.additionalRulesPaths ?? [];
  }

  /**
   * Load policy for a given project root.
   */
  async load(projectRoot: string): Promise<PolicyManifest> {
    const cacheKey = this.getCacheKey(projectRoot);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.manifest;
    }

    const manifest = await this.buildManifest(projectRoot);
    this.cache.set(cacheKey, { manifest, cachedAt: Date.now() });
    return manifest;
  }

  /**
   * Load policy for a specific target file (considers scoped rules).
   */
  async loadForTarget(projectRoot: string, targetPath?: string): Promise<PolicyManifest> {
    if (!targetPath) {
      return this.load(projectRoot);
    }

    // Check if target is in a specific scope
    const relativePath = relative(projectRoot, targetPath);
    const scope = this.inferScope(relativePath);
    
    const manifest = await this.load(projectRoot);
    
    // Filter sources to only those applicable to this scope
    if (scope) {
      manifest.sources = manifest.sources.filter(s => 
        s.scope === "" || scope.startsWith(s.scope) || s.scope.startsWith(scope)
      );
      // Recompute revision if sources changed
      if (manifest.sources.length > 0) {
        manifest.revision = this.computeRevision(manifest.sources);
      }
    }
    
    return manifest;
  }

  /**
   * Invalidate cache for a project root.
   */
  invalidateCache(projectRoot?: string): void {
    if (projectRoot) {
      this.cache.delete(this.getCacheKey(projectRoot));
    } else {
      this.cache.clear();
    }
  }

  /**
   * Build manifest for a project root.
   */
  private async buildManifest(projectRoot: string): Promise<PolicyManifest> {
    const sources: PolicySource[] = [];
    const errors: string[] = [];

    // 1. Load harness-owned rules first (highest priority)
    const harnessSources = await this.loadHarnessRules();
    sources.push(...harnessSources);

    // 2. Load project rules (if project is trusted)
    const trust = this.evaluateTrust(projectRoot);
    
    if (trust !== "unknown") {
      const projectSources = await this.loadProjectRules(projectRoot);
      sources.push(...projectSources);
    } else {
      // Project not trusted, but we still try to load AGENTS.md as advisory
      const untrustedSources = await this.loadProjectRules(projectRoot, true);
      sources.push(...untrustedSources);
    }

    // 3. Compute revision from mandatory sources
    const mandatorySources = sources.filter(s => s.priority === "mandatory");
    const revision = this.computeRevision(mandatorySources);

    // 4. Determine coverage
    const coverage = this.determineCoverage(sources, errors);

    return {
      revision,
      projectRoot: resolve(projectRoot),
      trust,
      coverage,
      sources,
      loadedAt: Date.now(),
      loadError: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }

  /**
   * Load harness-owned rule files.
   */
  private async loadHarnessRules(): Promise<PolicySource[]> {
    const sources: PolicySource[] = [];

    // Load main harness AGENTS.md
    if (existsSync(this.harnessRulesPath)) {
      try {
        const content = readFileSync(this.harnessRulesPath, "utf8");
        const normalized = this.normalizeContent(content);
        const sha256 = this.hashContent(normalized);
        
        sources.push({
          path: this.harnessRulesPath.toString(),
          scope: "", // Root scope - applies everywhere
          priority: "mandatory",
          sha256,
          bytes: Buffer.byteLength(content, "utf8"),
          harnessOwned: true,
        });
      } catch (err) {
        throw new Error(`Failed to load harness rules from ${this.harnessRulesPath}: ${err}`);
      }
    } else {
      throw new Error(`Harness rules not found at ${this.harnessRulesPath}`);
    }

    // Load additional harness rules
    for (const rulesPath of this.additionalRulesPaths) {
      if (existsSync(rulesPath)) {
        try {
          const content = readFileSync(rulesPath, "utf8");
          const normalized = this.normalizeContent(content);
          const sha256 = this.hashContent(normalized);
          
          sources.push({
            path: rulesPath.toString(),
            scope: "", // Root scope
            priority: "mandatory",
            sha256,
            bytes: Buffer.byteLength(content, "utf8"),
            harnessOwned: true,
          });
        } catch (err) {
          console.error(`Failed to load additional rules from ${rulesPath}: ${err}`);
        }
      }
    }

    return sources;
  }

  /**
   * Load project-owned rule files, walking from root toward target.
   */
  private async loadProjectRules(
    projectRoot: string,
    forceAdvisory = false
  ): Promise<PolicySource[]> {
    const sources: PolicySource[] = [];
    let dir = projectRoot;
    let depth = 0;

    while (dir && depth < MAX_WALK_DEPTH) {
      for (const fileName of RULE_FILE_NAMES) {
        const filePath = join(dir, fileName);
        
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, "utf8");
            const normalized = this.normalizeContent(content);
            const sha256 = this.hashContent(normalized);
            
            // Determine priority and scope
            const isMandatory = fileName === "AGENTS.md" && !forceAdvisory;
            const scope = dir === projectRoot ? "" : "/" + relative(projectRoot, dir);
            
            sources.push({
              path: filePath,
              scope,
              priority: isMandatory ? "mandatory" : "advisory",
              sha256,
              bytes: Buffer.byteLength(content, "utf8"),
              harnessOwned: false,
            });
          } catch (err) {
            console.error(`Failed to load project rule ${filePath}: ${err}`);
          }
        }
      }

      // Move to parent directory
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      depth++;
    }

    return sources;
  }

  /**
   * Evaluate trust level for a project.
   */
  private evaluateTrust(projectRoot: string): "trusted" | "untrusted" | "unknown" {
    let trustIndicatorsFound = 0;
    let untrustIndicatorsFound = 0;

    for (const indicator of TRUST_INDICATORS) {
      if (existsSync(join(projectRoot, indicator))) {
        trustIndicatorsFound++;
      }
    }

    // Check for untrusted indicators (e.g., downloaded zip, unknown origin)
    // For now, presence of .git or package.json means trusted
    if (trustIndicatorsFound > 0) {
      return "trusted";
    }

    return "unknown";
  }

  /**
   * Infer the scope from a relative path.
   */
  private inferScope(relativePath: string): string {
    // Extract directory component
    const segments = relativePath.split("/");
    if (segments.length <= 1) {
      return ""; // Root scope
    }
    
    // If first segment is "src" or "packages", use that as scope
    if (segments[0] === "src" || segments[0] === "packages") {
      return segments[0] + "/";
    }
    
    // Otherwise, use the directory containing the file
    if (segments.length > 1) {
      return segments.slice(0, -1).join("/") + "/";
    }
    
    return "";
  }

  /**
   * Normalize content for consistent hashing.
   */
  private normalizeContent(content: string): string {
    return content
      .replace(/\r\n/g, "\n")  // Normalize line endings
      .replace(/\t/g, "    ")  // Normalize tabs
      .replace(/[ \t]+$/gm, "") // Trim trailing whitespace
      .replace(/\n{3,}/g, "\n\n"); // Collapse excessive newlines
  }

  /**
   * Compute SHA-256 hash of content.
   */
  private hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
  }

  /**
   * Compute combined revision from sources.
   */
  private computeRevision(sources: PolicySource[]): string {
    // Sort by path for deterministic ordering
    const sorted = [...sources].sort((a, b) => a.path.localeCompare(b.path));
    const combined = sorted.map(s => s.sha256).join("|");
    return this.hashContent(combined);
  }

  /**
   * Determine coverage based on loaded sources and errors.
   */
  private determineCoverage(sources: PolicySource[], errors: string[]): "complete" | "partial" | "degraded" {
    if (errors.length > 0) {
      return "degraded";
    }

    const mandatorySources = sources.filter(s => s.priority === "mandatory");
    if (mandatorySources.length === 0) {
      return "degraded"; // No mandatory rules loaded
    }

    // Check if any mandatory sources failed to load (bytes === 0)
    if (mandatorySources.some(s => s.bytes === 0)) {
      return "partial";
    }

    return "complete";
  }

  /**
   * Generate cache key for a project root.
   */
  private getCacheKey(projectRoot: string): string {
    return resolve(projectRoot);
  }

  /**
   * Read the raw content of a source file.
   */
  readSourceContent(path: string): string | null {
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PolicyLoader with the standard harness configuration.
 */
export function createPolicyLoader(): PolicyLoader {
  // Resolve harness AGENTS.md relative to the package root (pi-harness-runtime/)
  // import.meta.url is packages/agent-policy/src/policy-loader.ts
  // So we go up 3 levels to reach the package root
  const packageRoot = new URL("../../..", import.meta.url);
  const harnessRulesPath = new URL("AGENTS.md", packageRoot);

  return new PolicyLoader({
    harnessRulesPath,
  });
}

/**
 * Scope Discovery
 * 
 * Discovers and estimates the scope of refactoring work.
 */

import { readFileSync, readdirSync } from "fs";
import { join, extname, relative } from "path";
import { execSync } from "child_process";

/**
 * File pattern matcher
 */
export interface FilePattern {
  /** Glob pattern or exact extension */
  pattern: string;
  /** Whether to recurse into directories */
  recursive?: boolean;
}

/**
 * Scope discovery configuration
 */
export interface ScopeDiscoveryConfig {
  /** File extensions to consider relevant */
  relevantExtensions: string[];
  /** Directories to exclude (vendored, generated, etc.) */
  excludeDirs: string[];
  /** Files to exclude by name */
  excludeFiles: string[];
  /** Whether to scan for call sites */
  scanCallSites: boolean;
  /** Call site patterns to count */
  callSitePatterns: string[];
}

/**
 * Default scope discovery config
 */
export const DEFAULT_SCOPE_CONFIG: ScopeDiscoveryConfig = {
  relevantExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"],
  excludeDirs: [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "__pycache__",
    "vendor",
    "generated",
    ".venv",
    "coverage",
  ],
  excludeFiles: [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "*.min.js",
    "*.bundle.js",
  ],
  scanCallSites: true,
  callSitePatterns: [
    "TODO:",
    "FIXME:",
    "console.log",
    "throw new",
    "await this",
    "// @ts-ignore",
  ],
};

/**
 * Discovered scope result
 */
export interface DiscoveredScope {
  /** Total relevant files found */
  totalFiles: number;
  /** Files matching the refactoring pattern */
  matchingFiles: number;
  /** Estimated call sites */
  callSites: number;
  /** Independent components found */
  components: string[];
  /** File breakdown by type */
  fileTypes: Record<string, number>;
  /** Whether shared APIs were detected */
  hasSharedApis: boolean;
  /** Whether transformation appears mechanical */
  isMechanical: boolean;
  /** Scope fingerprint for change detection */
  fingerprint: string;
}

/**
 * Discover scope by scanning files
 */
export function discoverScope(
  workspacePath: string,
  searchPattern: string,
  config: Partial<ScopeDiscoveryConfig> = {}
): DiscoveredScope {
  const cfg = { ...DEFAULT_SCOPE_CONFIG, ...config };
  const files: string[] = [];
  const fileTypes: Record<string, number> = {};
  const callSites: string[] = [];
  const components: Set<string> = new Set();

  // Scan directory recursively
  scanDirectory(workspacePath, files, fileTypes, cfg, 0);

  // Filter to relevant files
  const relevantFiles = files.filter((f) =>
    cfg.relevantExtensions.includes(extname(f))
  );

  // Count matching files and call sites
  let matchingCount = 0;
  for (const file of relevantFiles) {
    const content = readFileSync(file, "utf8").slice(0, 10000); // First 10KB

    // Check if file matches search pattern
    if (content.toLowerCase().includes(searchPattern.toLowerCase())) {
      matchingCount++;

      // Count call sites
      if (cfg.scanCallSites) {
        for (const pattern of cfg.callSitePatterns) {
          const matches = content.match(new RegExp(pattern, "gi"));
          if (matches) {
            callSites.push(...matches.map((m) => `${file}:${m}`));
          }
        }
      }

      // Identify component (directory)
      const relPath = relative(workspacePath, file);
      const parts = relPath.split("/");
      if (parts.length > 1) {
        components.add(parts.slice(0, -1).join("/"));
      }
    }
  }

  // Detect shared APIs (files that are imported by multiple components)
  const hasSharedApis = detectSharedApis(relevantFiles);

  // Detect if transformation is mechanical (simple replacements)
  const isMechanical = detectMechanicalPattern(relevantFiles, searchPattern);

  // Generate fingerprint
  const fingerprint = generateFingerprint(matchingCount, callSites.length, components.size);

  return {
    totalFiles: relevantFiles.length,
    matchingFiles: matchingCount,
    callSites: callSites.slice(0, 100).length,
    components: Array.from(components),
    fileTypes,
    hasSharedApis,
    isMechanical,
    fingerprint,
  };
}

/**
 * Recursively scan directory
 */
function scanDirectory(
  dir: string,
  files: string[],
  fileTypes: Record<string, number>,
  config: ScopeDiscoveryConfig,
  depth: number
): void {
  if (depth > 10) return; // Max depth guard

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip excluded
      if (config.excludeDirs.includes(entry.name)) continue;
      if (config.excludeFiles.some((f) => entry.name.includes(f))) continue;

      if (entry.isDirectory()) {
        scanDirectory(fullPath, files, fileTypes, config, depth + 1);
      } else if (entry.isFile()) {
        files.push(fullPath);
        const ext = extname(entry.name);
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

/**
 * Detect if files have shared API patterns
 */
function detectSharedApis(files: string[]): boolean {
  // Look for common export patterns
  const exportCounts = new Map<string, number>();

  for (const file of files.slice(0, 50)) {
    // Sample first 50 files
    try {
      const content = readFileSync(file, "utf8").slice(0, 5000);

      // Count exports
      const exportMatches = content.match(/export\s+(const|function|class|type|interface)/g);
      if (exportMatches) {
        exportCounts.set(file, (exportCounts.get(file) || 0) + exportMatches.length);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Multiple files with exports suggests shared APIs
  let filesWithExports = 0;
  for (const count of exportCounts.values()) {
    if (count > 0) filesWithExports++;
  }

  return filesWithExports > 3;
}

/**
 * Detect if transformation is mechanical (simple replacements)
 */
function detectMechanicalPattern(files: string[], searchPattern: string): boolean {
  // Mechanical = simple string replacement, no complex logic
  // Look for consistent patterns

  let mechanicalCount = 0;
  let totalMatches = 0;

  for (const file of files.slice(0, 20)) {
    try {
      const content = readFileSync(file, "utf8");
      const matches = content.match(
        new RegExp(searchPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
      );

      if (matches) {
        totalMatches += matches.length;

        // Check if each match is a simple replacement (same context)
        // Mechanical if: same indentation, same surrounding code pattern
        const uniqueContexts = new Set<string>();

        for (const match of matches.slice(0, 5)) {
          const idx = content.indexOf(match);
          const before = content.slice(Math.max(0, idx - 20), idx);
          const after = content.slice(idx + match.length, idx + match.length + 20);
          uniqueContexts.add(before.trim() + "|" + after.trim());
        }

        // Single context = mechanical
        if (uniqueContexts.size === 1) {
          mechanicalCount++;
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // More than half mechanical = likely mechanical
  return totalMatches > 0 && mechanicalCount / totalMatches > 0.5;
}

/**
 * Generate scope fingerprint
 */
function generateFingerprint(
  fileCount: number,
  callSiteCount: number,
  componentCount: number
): string {
  // Simple fingerprint based on counts
  const data = `${fileCount}:${callSiteCount}:${componentCount}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Quick scope estimate using git grep
 */
export function quickScopeEstimate(
  workspacePath: string,
  pattern: string
): { fileCount: number; lineCount: number } {
  // Validate inputs to prevent command injection
  const safePath = validatePath(workspacePath);
  if (!safePath) return { fileCount: 0, lineCount: 0 };

  const safePattern = escapeForGrep(pattern);
  if (!safePattern) return { fileCount: 0, lineCount: 0 };

  try {
    const result = execSync(
      `grep -r "${safePattern}" "${safePath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -l 2>/dev/null | wc -l`,
      { encoding: "utf8", timeout: 10000 }
    );

    const fileCount = parseInt(result.trim(), 10) || 0;

    const lineResult = execSync(
      `grep -r "${safePattern}" "${safePath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null | wc -l`,
      { encoding: "utf8", timeout: 10000 }
    );

    const lineCount = parseInt(lineResult.trim(), 10) || 0;

    return { fileCount, lineCount };
  } catch {
    return { fileCount: 0, lineCount: 0 };
  }
}

/**
 * Validate and sanitize a file path
 */
function validatePath(path: string): string | null {
  // Only allow alphanumeric, hyphen, underscore, dot, and forward slash
  if (!/^[\w./-]+$/.test(path)) {
    return null;
  }
  // Prevent path traversal
  if (path.includes("..")) {
    return null;
  }
  return path;
}

/**
 * Escape a string for safe use in grep pattern
 */
function escapeForGrep(pattern: string): string {
  // Remove any shell metacharacters
  return pattern.replace(/[|;&$`\\"'<>\(\)\[\]\{\}]/g, "");
}

/**
 * write-review - Two-agent code writing with review loop
 *
 * Integrates with pi-harness-runtime via:
 * - Smart trigger detection (prompt files in wiki/)
 * - System prompt injection for writer agent
 * - Subagent integration for reviewer agent
 *
 * Directory structure: {project}/.write-review/
 */

import { rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const MAX_AGE_DAYS = 3;

/**
 * Auto-cleanup old review history files older than MAX_AGE_DAYS
 */
export function cleanupOldReviews(projectPath: string): number {
  // Resolve path to prevent traversal attacks
  const basePath = resolve(projectPath);
  const reviewDir = join(basePath, ".write-review");
  
  // Ensure reviewDir is within basePath (traversal guard)
  if (!reviewDir.startsWith(basePath + '/')) {
    return 0; // Invalid path, skip
  }
  
  if (!existsSync(reviewDir)) {
    return 0; // Directory doesn't exist
  }
  
  let deleted = 0;
  const files = readdirSync(reviewDir);
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  
  for (const file of files) {
    if (file === "status.json") continue; // Keep status file
    // Sanitize filename to prevent path traversal
    const sanitized = file.replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (sanitized !== file) continue; // Skip suspicious filenames
    
    const filePath = join(reviewDir, sanitized);
    try {
      const stats = statSync(filePath);
      if (stats.mtimeMs < cutoff) {
        rmSync(filePath, { force: true });
        deleted++;
      }
    } catch {
      // Ignore files that can't be read
    }
  }
  
  return deleted;
}

// Re-export all public APIs
export * from "./types.js";
export * from "./blackboard.js";
export * from "./trigger.js";
export * from "./injection.js";
export * from "./gate.js";
export * from "./review.js";

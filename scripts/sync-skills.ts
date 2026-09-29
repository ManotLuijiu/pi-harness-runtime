/**
 * Skills Sync Script
 * 
 * Sync skills from a source directory to ~/.pi-harness-runtime/skills/
 * 
 * Usage:
 *   bun scripts/sync-skills.ts --from ~/my-skills --to ~/.pi-harness-runtime/skills
 *   bun scripts/sync-skills.ts --from ~/frappe-bench/.claude-plugins/moocoding-skills/skills
 *   bun scripts/sync-skills.ts --list              # List skills in target dir
 *   bun scripts/sync-skills.ts --check-only        # Check without copying
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

// Default paths
const DEFAULT_TARGET = join(homedir(), ".pi-harness-runtime", "skills");

interface SyncOptions {
  from: string;
  to: string;
  checkOnly: boolean;
  verbose: boolean;
  clean: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): SyncOptions {
  const args = process.argv.slice(2);
  let from: string | undefined;
  let to = DEFAULT_TARGET;
  let checkOnly = false;
  let verbose = false;
  let clean = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--from" || arg === "-f") {
      from = args[++i];
    } else if (arg === "--to" || arg === "-t") {
      to = args[++i];
    } else if (arg === "--check-only" || arg === "-c") {
      checkOnly = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--clean") {
      clean = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--list") {
      listSkills(to);
      process.exit(0);
    }
  }

  if (!from) {
    console.error("Error: --from <source> is required");
    printHelp();
    process.exit(1);
  }

  return { from, to, checkOnly, verbose, clean };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Skills Sync Script
─────────────────
Sync skills from a source directory to ~/.pi-harness-runtime/skills/

Usage:
  bun scripts/sync-skills.ts --from <source> [options]

Options:
  --from, -f <path>    Source directory containing skills (required)
  --to, -t <path>      Target directory (default: ~/.pi-harness-runtime/skills)
  --list               List skills in target directory
  --check-only, -c     Check what would be copied without copying
  --verbose, -v        Show detailed output
  --clean              Remove skills not in source
  --help, -h           Show this help message

Examples:
  # Sync from a local directory
  bun scripts/sync-skills.ts --from ~/my-skills

  # Sync from frappe-bench moocoding skills
  bun scripts/sync-skills.ts --from ~/frappe-bench/.claude-plugins/moocoding-skills/skills

  # Check what would be synced
  bun scripts/sync-skills.ts --from ~/my-skills --check-only

  # List current skills
  bun scripts/sync-skills.ts --list
`);
}

/**
 * List skills in a directory
 */
function listSkills(dir: string): void {
  if (!existsSync(dir)) {
    console.log(`Directory does not exist: ${dir}`);
    console.log(`Run without --list to create it.`);
    return;
  }

  const skills = getSkillDirs(dir);
  if (skills.length === 0) {
    console.log(`No skills found in ${dir}`);
    return;
  }

  console.log(`Skills in ${dir}:`);
  console.log("");
  for (const skill of skills) {
    console.log(`  - ${basename(skill)}`);
  }
  console.log("");
  console.log(`Total: ${skills.length} skills`);
}

/**
 * Get skill directories (directories containing SKILL.md)
 */
function getSkillDirs(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const skills: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Check if it contains SKILL.md
      const skillMdPath = join(fullPath, "SKILL.md");
      if (existsSync(skillMdPath)) {
        skills.push(fullPath);
      } else {
        // Recursively search subdirectories
        skills.push(...getSkillDirs(fullPath));
      }
    }
  }

  return skills;
}

/**
 * Copy a directory recursively
 */
function copyDirRecursive(src: string, dest: string, verbose: boolean): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);

  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath, verbose);
    } else {
      copyFileSync(srcPath, destPath);
      if (verbose) {
        console.log(`  Copied: ${entry}`);
      }
    }
  }
}

/**
 * Sync skills from source to target
 */
function syncSkills(options: SyncOptions): void {
  const { from, to, checkOnly, verbose, clean } = options;

  // Validate source
  if (!existsSync(from)) {
    console.error(`Error: Source directory does not exist: ${from}`);
    process.exit(1);
  }

  // Create target if needed
  if (!checkOnly && !existsSync(to)) {
    console.log(`Creating target directory: ${to}`);
    mkdirSync(to, { recursive: true });
  }

  // Find skills in source
  console.log(`Scanning source: ${from}`);
  const sourceSkills = getSkillDirs(from);
  console.log(`Found ${sourceSkills.length} skill(s) in source`);

  if (sourceSkills.length === 0) {
    console.log("No skills found. Make sure source contains directories with SKILL.md files.");
    return;
  }

  if (checkOnly) {
    console.log("\n[CHECK ONLY] Would sync the following skills:");
  } else {
    console.log("\nSyncing skills:");
  }

  const targetSkills: string[] = [];
  const toClean: string[] = [];

  for (const skillPath of sourceSkills) {
    const skillName = basename(skillPath);
    const targetPath = join(to, skillName);

    console.log(`  ${checkOnly ? "[ ]" : "[x]"} ${skillName}`);
    targetSkills.push(skillName);

    if (!checkOnly) {
      copyDirRecursive(skillPath, targetPath, verbose);
    }
  }

  // Clean: remove skills in target not in source
  if (clean) {
    console.log("\nChecking for skills to remove...");
    const existingTargetSkills = getSkillDirs(to);
    const sourceSkillNames = new Set(sourceSkills.map(s => basename(s)));

    for (const existingPath of existingTargetSkills) {
      const existingName = basename(existingPath);
      if (!sourceSkillNames.has(existingName)) {
        toClean.push(existingPath);
        console.log(`  [-] ${existingName} (not in source)`);
      }
    }

    if (!checkOnly && toClean.length > 0) {
      console.log("\nRemoving orphaned skills...");
      for (const path of toClean) {
        rmSync(path, { recursive: true, force: true });
        console.log(`  Removed: ${basename(path)}`);
      }
    }
  }

  console.log("");
  if (checkOnly) {
    console.log(`Check complete. Run without --check-only to sync.`);
  } else {
    console.log(`Sync complete! ${sourceSkills.length} skill(s) synced to ${to}`);
  }

  // Show next steps
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Restart pi to load new skills`);
  console.log(`  2. Or run /reload in pi`);
  console.log(`  3. List skills: /skill list`);
}

// Main
const options = parseArgs();
syncSkills(options);

/**
 * TencentDB Sync CLI (RFC-0105/0106)
 *
 * Syncs SKILL.md files from skills directory to TencentDB
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import { createTencentDBClient } from "./client.js";

interface CliOptions {
  source: string;
  serverUrl: string;
  userKey: string;
  serviceId: string;
  watch: boolean;
  dryRun: boolean;
  force: boolean;
}

interface SkillInfo {
  path: string;
  name: string;
  content: string;
  mtime: Date;
}

/**
 * Parse SKILL.md frontmatter
 */
function parseFrontmatter(content: string): { name: string; description?: string; tags?: string[] } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: "" };

  const result: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1);
      result[key] = val.split(",").map((s) => s.trim());
    } else {
      result[key] = val;
    }
  }

  return {
    name: (result.name as string) || "",
    description: result.description as string,
    tags: result.tags as string[],
  };
}

/**
 * Load all SKILL.md files from a directory
 */
function loadSkills(sourcePath: string): SkillInfo[] {
  const skills: SkillInfo[] = [];

  function walk(dir: string): void {
    if (!existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      return;
    }

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const skillMd = join(fullPath, "SKILL.md");
        if (existsSync(skillMd)) {
          const content = readFileSync(skillMd, "utf-8");
          const fm = parseFrontmatter(content);
          const name = fm.name || entry.name;

          skills.push({
            path: skillMd,
            name,
            content,
            mtime: statSync(skillMd).mtime,
          });
        } else {
          // Recurse into subdirectories
          walk(fullPath);
        }
      } else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) {
        const content = readFileSync(fullPath, "utf-8");
        const fm = parseFrontmatter(content);
        const name = fm.name || basename(fullPath, extname(fullPath));

        skills.push({
          path: fullPath,
          name,
          content,
          mtime: statSync(fullPath).mtime,
        });
      }
    }
  }

  walk(sourcePath);
  return skills;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    source: "",
    serverUrl: process.env.TENANTDB_URL || process.env.MEMORY_SERVER_URL || "",
    userKey: process.env.TENANTDB_USER_KEY || process.env.MEMORY_USER_KEY || "",
    serviceId: process.env.TENANTDB_SERVICE_ID || process.env.MEMORY_SERVICE_ID || "default",
    watch: false,
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--source":
      case "-s":
        options.source = args[++i] || "";
        break;
      case "--server":
      case "--url":
        options.serverUrl = args[++i] || "";
        break;
      case "--key":
      case "-k":
        options.userKey = args[++i] || "";
        break;
      case "--service-id":
        options.serviceId = args[++i] || "default";
        break;
      case "--watch":
      case "-w":
        options.watch = true;
        break;
      case "--dry-run":
      case "-n":
        options.dryRun = true;
        break;
      case "--force":
      case "-f":
        options.force = true;
        break;
      case "--help":
      case "-h":
        console.log(`
TencentDB Sync CLI

Usage:
  tencentdb-sync [options]

Options:
  --source, -s <path>    Skills directory to sync (required)
  --server, --url <url>  TencentDB server URL (from TENANTDB_URL env)
  --key, -k <key>      User key (from TENANTDB_USER_KEY env)
  --service-id <id>     Service ID (default: "default")
  --watch, -w          Watch for file changes
  --dry-run, -n         Show what would be synced
  --force, -f           Force sync even if unchanged
  --help, -h           Show this help

Environment:
  TENANTDB_URL       Server URL (e.g., https://memory.example.com)
  TENANTDB_USER_KEY  User key (sk-mem-xxx)
  TENANTDB_SERVICE_ID Service ID (default: default)
  TENANTDB_SOURCE    Default skills source path
        `);
        process.exit(0);
    }
  }

  // Use default source if not specified
  if (!options.source) {
    options.source = process.env.TENANTDB_SOURCE || 
      join(homedir(), "frappe-bench", ".claude-plugins", "moocoding-skills", "skills");
  }

  return options;
}

/**
 * Sync one skill
 */
async function syncSkill(
  client: ReturnType<typeof createTencentDBClient>,
  skill: SkillInfo,
  force: boolean,
): Promise<boolean> {
  try {
    const fm = parseFrontmatter(skill.content);

    // Check if skill exists
    const existing = await client.skillGet(skill.name);

    if (existing && !force) {
      // Skip if not modified
      const existingMtime = new Date(existing.updated_at_ms);
      if (existingMtime >= skill.mtime) {
        console.log(`  Skip: ${skill.name} (unchanged)`);
        return true;
      }
    }

    // Create or update
    if (existing) {
      console.log(`  Update: ${skill.name}`);
      await client.skillUpdate({
        name: skill.name,
        content: skill.content,
        description: fm.description,
      });
    } else {
      console.log(`  Create: ${skill.name}`);
      await client.skillCreate({
        name: skill.name,
        content: skill.content,
        description: fm.description,
        tags: fm.tags,
      });
    }

    return true;
  } catch (error) {
    console.error(`  Error: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Main sync function
 */
async function sync(options: CliOptions): Promise<void> {
  console.log(`\nTencentDB Sync`);
  console.log(`==============`);
  console.log(`Source: ${options.source}`);
  console.log(`Server: ${options.serverUrl}`);
  console.log(`Service: ${options.serviceId}`);
  console.log(`Dry run: ${options.dryRun}`);
  console.log();

  if (!options.serverUrl || !options.userKey) {
    console.error("Error: Missing TENANTDB_URL or TENANTDB_USER_KEY");
    console.error(`\nSet environment variables or use --server and --key options`);
    process.exit(1);
  }

  // Create client
  const client = createTencentDBClient({
    serverUrl: options.serverUrl,
    userKey: options.userKey,
    serviceId: options.serviceId,
  });

  // Health check
  try {
    const health = await client.health();
    console.log(`Server status: ${health.status}`);
    if (health.version) console.log(`Version: ${health.version}`);
  } catch (error) {
    console.error(`Error: Cannot connect to server: ${error}`);
    process.exit(1);
  }

  // Load skills
  console.log(`\nLoading skills from ${options.source}...`);
  const skills = loadSkills(options.source);
  console.log(`Found ${skills.length} skills\n`);

  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }

  // Sync each skill
  let success = 0;
  let failed = 0;

  for (const skill of skills) {
    process.stdout.write(`Syncing ${skill.name}...`);

    if (options.dryRun) {
      console.log(` [DRY RUN]`);
      success++;
    } else {
      const ok = await syncSkill(client, skill, options.force);
      if (ok) {
        console.log(` [OK]`);
        success++;
      } else {
        console.log(` [FAILED]`);
        failed++;
      }
    }
  }

  console.log(`\nSync complete: ${success} succeeded, ${failed} failed\n`);
}

/**
 * Watch mode
 */
async function watch(_options: CliOptions): Promise<void> {
  console.log("Watch mode not implemented yet.");
  console.log("Use --dry-run to preview what would be synced.");
  process.exit(1);
}

// Main
const options = parseArgs();

if (options.watch) {
  watch(options);
} else {
  sync(options);
}

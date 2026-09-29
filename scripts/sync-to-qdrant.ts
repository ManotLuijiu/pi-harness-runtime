#!/usr/bin/env bun
/**
 * Sync Skills to Qdrant
 * 
 * Uploads local skills to Qdrant vector database for team sharing.
 * 
 * Usage:
 *   bun scripts/sync-to-qdrant.ts --from ~/.pi-harness-runtime/skills
 *   bun scripts/sync-to-qdrant.ts --from ~/frappe-bench/.claude-plugins/moocoding-skills/skills
 *   bun scripts/sync-to-qdrant.ts --list          # List skills in Qdrant
 *   bun scripts/sync-to-qdrant.ts --search "..."    # Search skills in Qdrant
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import {
  getQdrantConfig,
  getQdrantApiKey,
  isQdrantAvailable,
  QdrantRestClient,
  type QdrantSkillDocument,
  type QdrantSearchResult,
} from "../packages/qdrant-skills/src/client.js";
import { embedSkillDocument } from "../packages/qdrant-skills/src/embedder.js";

/**
 * Parse YAML frontmatter from SKILL.md content
 */
function parseSkillFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

/**
 * Read a skill from directory
 */
function readSkill(dirPath: string): QdrantSkillDocument | null {
  const skillPath = join(dirPath, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  try {
    const content = readFileSync(skillPath, "utf-8");
    const frontmatter = parseSkillFrontmatter(content);
    
    if (!frontmatter) {
      console.error(`[Sync] No frontmatter in ${dirPath}`);
      return null;
    }

    const name = frontmatter.name || basename(dirPath);
    const description = frontmatter.description || "";
    const author = frontmatter.author || "unknown";
    const version = frontmatter.version || "1.0.0";
    const confidence = parseFloat(frontmatter.confidence || "0.5");

    // Extract body without frontmatter
    const body = content.replace(/^---[\s\S]*?---\n/, "").trim();

    return {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      description,
      body: body.slice(0, 5000), // Limit body size
      triggers: [],
      author,
      version,
      confidence,
      source: dirPath,
    };
  } catch (err) {
    console.error(`[Sync] Failed to read skill from ${dirPath}:`, err);
    return null;
  }
}

/**
 * Find skill directories
 */
function findSkillDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const skills: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      const skillPath = join(fullPath, "SKILL.md");
      if (existsSync(skillPath)) {
        skills.push(fullPath);
      }
    }
  }

  return skills;
}

/**
 * Sync skills from directory to Qdrant
 */
async function syncToQdrant(sourceDir: string, clear: boolean = false): Promise<void> {
  // Check Qdrant availability
  if (!isQdrantAvailable()) {
    console.error("Error: Qdrant API key not found.");
    console.error("Set QDRANT_API_KEY environment variable or create:");
    console.error("  ~/.pi-harness-runtime/keys/qdrant-api-key.txt");
    process.exit(1);
  }

  const config = getQdrantConfig();
  if (!config) {
    console.error("Error: Failed to get Qdrant config");
    process.exit(1);
  }

  const client = new QdrantRestClient(config);
  console.error(`[Sync] Connecting to Qdrant: ${config.url}`);

  // Ensure collection exists
  await client.ensureCollection(config.collectionName, config.vectorSize);

  // Find skills
  console.error(`[Sync] Scanning: ${sourceDir}`);
  const skillDirs = findSkillDirs(sourceDir);
  console.error(`[Sync] Found ${skillDirs.length} skills`);

  if (skillDirs.length === 0) {
    console.error("No skills found.");
    return;
  }

  // Clear collection if requested
  if (clear) {
    console.error("[Sync] Clearing existing collection...");
    await client.clearCollection(config.collectionName);
  }

  // Embed and upload skills
  const points: Array<{ id: string; vector: number[]; payload: QdrantSkillDocument }> = [];
  
  for (let i = 0; i < skillDirs.length; i++) {
    const dir = skillDirs[i];
    const skill = readSkill(dir);
    
    if (!skill) continue;

    process.stdout.write(`\r[Sync] Embedding ${i + 1}/${skillDirs.length}: ${skill.name}...`);

    try {
      const { embedding } = await embedSkillDocument(skill);
      points.push({
        id: skill.id,
        vector: embedding,
        payload: skill,
      });
    } catch (err) {
      console.error(`\n[Sync] Failed to embed ${skill.name}:`, err);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.error(`\n[Sync] Uploading ${points.length} skills to Qdrant...`);
  
  if (points.length > 0) {
    await client.uploadPoints(config.collectionName, points);
  }

  console.error(`[Sync] Complete! ${points.length} skills uploaded to Qdrant.`);
}

/**
 * List skills in Qdrant
 */
async function listSkillsInQdrant(): Promise<void> {
  if (!isQdrantAvailable()) {
    console.error("Error: Qdrant API key not found.");
    process.exit(1);
  }

  const config = getQdrantConfig();
  if (!config) {
    console.error("Error: Failed to get Qdrant config");
    process.exit(1);
  }

  const client = new QdrantRestClient(config);
  
  try {
    const info = await client.getCollectionInfo(config.collectionName);
    console.error(`Collection: ${config.collectionName}`);
    console.error(`Points: ${info.pointsCount}`);
  } catch (err) {
    console.error("Collection not found or empty.");
  }
}

/**
 * Search skills in Qdrant
 */
async function searchSkillsInQdrant(query: string): Promise<void> {
  if (!isQdrantAvailable()) {
    console.error("Error: Qdrant API key not found.");
    process.exit(1);
  }

  const config = getQdrantConfig();
  if (!config) {
    console.error("Error: Failed to get Qdrant config");
    process.exit(1);
  }

  const client = new QdrantRestClient(config);
  const { embedSkillDocument } = await import("../packages/qdrant-skills/src/embedder.js");

  console.error(`[Search] Query: "${query}"`);

  try {
    // Create embedding for query
    const tempDoc: QdrantSkillDocument = {
      id: "query",
      name: "query",
      description: query,
      body: "",
      triggers: [],
      author: "query",
      version: "1.0.0",
      confidence: 1.0,
    };

    const { embedding } = await embedSkillDocument(tempDoc);
    const results = await client.search(config.collectionName, embedding, 10);

    console.error(`\nFound ${results.length} skills:\n`);
    for (const result of results) {
      console.error(`[${(result.score * 100).toFixed(1)}%] ${result.document.name}`);
      console.error(`  ${result.document.description.slice(0, 100)}...`);
      console.error("");
    }
  } catch (err) {
    console.error("Search failed:", err);
    process.exit(1);
  }
}

// CLI
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Sync Skills to Qdrant
────────────────────
Upload local skills to Qdrant for team sharing.

Usage:
  bun scripts/sync-to-qdrant.ts --from <dir>     Sync skills from directory
  bun scripts/sync-to-qdrant.ts --from <dir> --clear  Clear and re-upload
  bun scripts/sync-to-qdrant.ts --list            List skills in Qdrant
  bun scripts/sync-to-qdrant.ts --search <query>  Search skills in Qdrant
  bun scripts/sync-to-qdrant.ts --help             Show this help

Environment:
  QDRANT_API_KEY    Your Qdrant Cloud API key
  QDRANT_URL        Qdrant URL (default: https://api.qdrant.tech)
  QDRANT_COLLECTION Collection name (default: pi-harness-skills)

Or create file:
  ~/.pi-harness-runtime/keys/qdrant-api-key.txt
`);
  process.exit(0);
}

if (args.includes("--list")) {
  await listSkillsInQdrant();
  process.exit(0);
}

const searchIdx = args.indexOf("--search");
if (searchIdx !== -1 && args[searchIdx + 1]) {
  await searchSkillsInQdrant(args[searchIdx + 1]);
  process.exit(0);
}

const fromIdx = args.indexOf("--from");
if (fromIdx === -1 || !args[fromIdx + 1]) {
  console.error("Error: --from <directory> is required");
  console.error("Use --help for usage information.");
  process.exit(1);
}

const sourceDir = args[fromIdx + 1];
const clear = args.includes("--clear");

await syncToQdrant(sourceDir, clear);

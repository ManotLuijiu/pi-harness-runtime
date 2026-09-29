#!/usr/bin/env bun
/**
 * Sync Skills to Qdrant
 * 
 * Uploads local skills to Qdrant vector database for team sharing.
 * FILTERS OUT client-specific skills (only MooCoding/AWS content allowed).
 * 
 * Usage:
 *   bun scripts/sync-to-qdrant.ts --from ~/.pi-harness-runtime/skills
 *   bun scripts/sync-to-qdrant.ts --list          # List skills in Qdrant
 *   bun scripts/sync-to-qdrant.ts --search "..."  # Search skills in Qdrant
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";

// =============================================================================
// BLOCKED: Client company names that will be EXCLUDED from sync
// =============================================================================
const BLOCKED_COMPANY_PATTERNS = [
  'inpac',
  'm-capital',
  'mcapital', 
  'digisoft',
  'cloudshot',
  'paperclip',
  'teamw',
  'openclaw',
  'autoresearch',
];

const BLOCKED_SKILL_NAMES = [
  'autoresearch-invoice',
  'bullmq-provisioning',
  'create-form-report-template',
  'cross-version-cherry-pick',
  'data-seeding-hooks',
  'frappe-custom-page',
  'frappe-desktop-icon-debugging',
  'frappe-manual-generator',
  'frappe-pdf-css-injection',
  'frappe-permission-manager',
  'frappe-print-format',
  'frappe-print-page-override',
  'frappe-setup-wizard',
  'frappe-tusd-upload',
  'github-translation-sync',
  'gse-insurance',
  'inpac-',
  'interactive-crop-overlay',
  'mariadb-optimization',
  'openclaw-channel',
  'override-grid-view',
  'playwright-frappe-testing',
  'release-app',
  's3-presigned-url-refresh',
  'spa-multi-app-routing',
  'tbs-import',
  'thai-accounting-books',
  'thai-account-language-toggle',
  'thai-withholding-tax',
  'translation-tools-bench',
  'whispertool',
  'workspace-knowledge',
  'workspace-sync',
  'zshrc-app-hooks',
];

// =============================================================================
// Qdrant Config
// =============================================================================

interface QdrantConfig {
  url: string;
  apiKey: string;
  collection: string;
}

function getQdrantConfig(): QdrantConfig | null {
  // Check env vars
  let apiKey = process.env.QDRANT_API_KEY;
  const url = process.env.QDRANT_CLUSTER_ENDPOINT || "https://api.qdrant.tech";
  const collection = process.env.QDRANT_COLLECTION || "pi-harness-skills";
  
  // Check keys file
  if (!apiKey) {
    const keyPath = `${process.env.HOME}/.pi-harness-runtime/keys/qdrant-api-key.txt`;
    if (existsSync(keyPath)) {
      apiKey = readFileSync(keyPath, "utf-8").trim();
    }
  }
  
  if (!apiKey) return null;
  
  return { url, apiKey, collection };
}

function parseHostPort(url: string): { host: string; port: number } {
  const match = url.match(/https?:\/\/([^:]+)(?::(\d+))?/);
  return {
    host: match?.[1] || url,
    port: parseInt(match?.[2] || "6333"),
  };
}

// =============================================================================
// Skill Reading
// =============================================================================

interface SkillDoc {
  id: number;
  name: string;
  description: string;
  body: string;
  text: string;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fm;
}

function isSkillBlocked(name: string, content: string): boolean {
  const lowerName = name.toLowerCase();
  
  // Check skill name
  for (const blocked of BLOCKED_SKILL_NAMES) {
    if (lowerName.includes(blocked)) return true;
  }
  
  // Check content for company names
  const lowerContent = content.toLowerCase();
  for (const company of BLOCKED_COMPANY_PATTERNS) {
    if (lowerContent.includes(company)) return true;
  }
  
  return false;
}

function readSkill(dirPath: string): SkillDoc | null {
  const skillPath = join(dirPath, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  try {
    const content = readFileSync(skillPath, "utf-8");
    const fm = parseFrontmatter(content);
    if (!fm) return null;

    const name = fm.name || basename(dirPath);
    const description = fm.description || "";
    const body = content.replace(/^---[\s\S]*?---\n/, "").trim();
    
    // Text for embedding
    const text = `${name}. ${description}. ${body.slice(0, 1000)}`;
    
    // Check if blocked
    if (isSkillBlocked(name, content)) {
      return null; // Skip blocked skills
    }

    return {
      id: 0, // Will be set during sync
      name,
      description,
      body: body.slice(0, 2000),
      text,
    };
  } catch {
    return null;
  }
}

function findSkillDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  
  return readdirSync(dir)
    .map(entry => join(dir, entry))
    .filter(fullPath => {
      const stat = statSync(fullPath);
      return stat.isDirectory() && existsSync(join(fullPath, "SKILL.md"));
    });
}

// =============================================================================
// Qdrant Operations
// =============================================================================

async function ensureCollection(client: QdrantClient, name: string): Promise<void> {
  try {
    await client.createCollection(name, {
      vectors: { size: 384, distance: "Cosine" }
    });
  } catch {
    // Already exists - OK
  }
}

async function clearCollection(client: QdrantClient, name: string): Promise<void> {
  try {
    await client.deleteCollection(name);
    await ensureCollection(client, name);
  } catch {
    // Ignore
  }
}

async function upsertSkills(
  client: QdrantClient,
  collectionName: string,
  skills: SkillDoc[]
): Promise<void> {
  const points = skills.map((skill, idx) => ({
    id: idx + 1,
    payload: {
      name: skill.name,
      description: skill.description,
      body: skill.body,
    },
    vector: {
      text: skill.text,
      model: "sentence-transformers/all-MiniLM-L6-v2"
    }
  }));
  
  await client.upsert(collectionName, { wait: true, points });
}

async function searchSkills(
  client: QdrantClient,
  collectionName: string,
  query: string
): Promise<void> {
  const results = await client.query(collectionName, {
    query: {
      text: query,
      model: "sentence-transformers/all-MiniLM-L6-v2"
    },
    limit: 10,
    with_payload: true,
  } as Parameters<typeof client.query>[1]);

  // Result format: { points: [...] }
  const points = (results as { points?: unknown[] })?.points || [];
  
  console.error(`\nFound ${points.length} skills:\n`);
  for (const r of points as Array<{ score: number; payload?: Record<string, string> }>) {
    console.error(`[${(r.score * 100).toFixed(1)}%] ${r.payload?.name || "unknown"}`);
    console.error(`  ${(r.payload?.description || "").slice(0, 80)}...`);
    console.error("");
  }
}

async function getCollectionInfo(client: QdrantClient, name: string): Promise<number> {
  try {
    const info = await client.getCollection(name);
    return (info as { result?: { points_count?: number } })?.result?.points_count || 0;
  } catch {
    return 0;
  }
}

// =============================================================================
// CLI Commands
// =============================================================================

async function syncToQdrant(sourceDir: string, clear: boolean = false): Promise<void> {
  const config = getQdrantConfig();
  if (!config) {
    console.error("Error: Qdrant API key not found.");
    console.error("Set QDRANT_API_KEY or create:");
    console.error("  ~/.pi-harness-runtime/keys/qdrant-api-key.txt");
    process.exit(1);
  }

  const { host, port } = parseHostPort(config.url);
  const client = new QdrantClient({ host, port, apiKey: config.apiKey });
  
  console.error(`[Sync] Connecting to Qdrant: ${config.url}`);
  console.error(`[Sync] Collection: ${config.collection}`);

  if (clear) {
    console.error("[Sync] Clearing collection...");
    await clearCollection(client, config.collection);
  } else {
    await ensureCollection(client, config.collection);
  }

  console.error(`[Sync] Scanning: ${sourceDir}`);
  const skillDirs = findSkillDirs(sourceDir);
  
  // Read and filter skills
  const skills: SkillDoc[] = [];
  const blocked: string[] = [];
  
  for (const dir of skillDirs) {
    const skill = readSkill(dir);
    if (skill) {
      skills.push(skill);
    } else {
      blocked.push(basename(dir));
    }
  }
  
  console.error(`[Sync] Found ${skillDirs.length} skills total`);
  console.error(`[Sync] Filtered: ${skills.length} allowed, ${blocked.length} blocked`);
  
  if (blocked.length > 0 && blocked.length <= 10) {
    console.error(`[Sync] Blocked skills: ${blocked.join(", ")}`);
  }

  if (skills.length === 0) {
    console.error("[Sync] No skills to upload.");
    return;
  }

  console.error(`[Sync] Uploading ${skills.length} skills to Qdrant...`);
  await upsertSkills(client, config.collection, skills);
  console.error(`[Sync] Complete! ${skills.length} skills uploaded.`);
}

async function listSkills(): Promise<void> {
  const config = getQdrantConfig();
  if (!config) {
    console.error("Error: Qdrant API key not found.");
    process.exit(1);
  }

  const { host, port } = parseHostPort(config.url);
  const client = new QdrantClient({ host, port, apiKey: config.apiKey });
  
  const count = await getCollectionInfo(client, config.collection);
  console.error(`Collection: ${config.collection}`);
  console.error(`Skills: ${count}`);
}

async function search(query: string): Promise<void> {
  const config = getQdrantConfig();
  if (!config) {
    console.error("Error: Qdrant API key not found.");
    process.exit(1);
  }

  const { host, port } = parseHostPort(config.url);
  const client = new QdrantClient({ host, port, apiKey: config.apiKey });
  
  console.error(`[Search] Query: "${query}"`);
  await searchSkills(client, config.collection, query);
}

// =============================================================================
// Main
// =============================================================================

const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log(`
Sync Skills to Qdrant (MooCoding/AWS Only)
──────────────────────────────────────────
Upload skills to Qdrant for team sharing.
CLIENT-SPECIFIC SKILLS ARE AUTOMATICALLY BLOCKED.

Usage:
  bun scripts/sync-to-qdrant.ts --from <dir>     Sync skills from directory
  bun scripts/sync-to-qdrant.ts --from <dir> --clear  Clear and re-upload
  bun scripts/sync-to-qdrant.ts --list            List skills in Qdrant
  bun scripts/sync-to-qdrant.ts --search <query>  Search skills in Qdrant
  bun scripts/sync-to-qdrant.ts --help            Show this help

Blocked Company Patterns:
  ${BLOCKED_COMPANY_PATTERNS.join(", ")}

Environment:
  QDRANT_API_KEY    Your Qdrant Cloud API key
  QDRANT_CLUSTER_ENDPOINT  Qdrant URL
  QDRANT_COLLECTION Collection name (default: pi-harness-skills)

Or create file:
  ~/.pi-harness-runtime/keys/qdrant-api-key.txt
`);
  process.exit(0);
}

if (args.includes("--list")) {
  await listSkills();
  process.exit(0);
}

const searchIdx = args.indexOf("--search");
if (searchIdx !== -1 && args[searchIdx + 1]) {
  await search(args[searchIdx + 1]);
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

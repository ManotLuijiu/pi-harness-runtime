#!/usr/bin/env bun
/**
 * Sync Skills to Qdrant
 * 
 * Uploads local skills to Qdrant vector database for team sharing.
 * SANITIZES client-specific data by replacing with placeholders.
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
// SANITIZATION: Replace client-specific names with placeholders
// =============================================================================

interface SanitizationRule {
  pattern: RegExp;
  replacement: string;
}

const SANITIZATION_RULES: SanitizationRule[] = [
  // Client company names (case-insensitive)
  { pattern: /\binpac\b/gi, replacement: "[Client A]" },
  { pattern: /\bm-capital\b/gi, replacement: "[Client A]" },
  { pattern: /\bmcapital\b/gi, replacement: "[Client A]" },
  { pattern: /\bdigisoft\b/gi, replacement: "[Client B]" },

  { pattern: /\bteamw\b/gi, replacement: "[Client E]" },
  { pattern: /\bopenclaw\b/gi, replacement: "[Client F]" },

  
  // Project/app specific names
  { pattern: /\bgse-insurance\b/gi, replacement: "[Insurance Project]" },
  { pattern: /\btbs-import\b/gi, replacement: "[Import Project]" },
  { pattern: /\bdigisoft_erp\b/gi, replacement: "[Client B Erp]" },
  { pattern: /\bm_capital\b/gi, replacement: "[Client A]" },
  { pattern: /\binpac_\b/gi, replacement: "[Client A]_" },
  { pattern: /\bpaperclip_\b/gi, replacement: "[Client D]_" },
  { pattern: /\bopenclaw_\b/gi, replacement: "[Client F]_" },

  { pattern: /\bteamw_\b/gi, replacement: "[Client E]_" },
  
  // Generic replacements
  { pattern: /Company Name/gi, replacement: "[Client Name]" },
  { pattern: /your company/gi, replacement: "[Client]" },
  { pattern: /our client/gi, replacement: "[Client]" },
  { pattern: /client-specific/gi, replacement: "[Project-specific]" },
];

// Skill name sanitization (for skill directory name -> sanitized display name)
const SKILL_NAME_MAP: Record<string, string> = {
  'gse-insurance-step5-slot-filter': 'insurance-project-step-filter',
  'inpac-pe-approval-workflow': 'client-a-pe-approval-workflow',
  'inpac-po-approval-workflow': 'client-a-po-approval-workflow',
  'inpac-pr-approval-workflow': 'client-a-pr-approval-workflow',
  'openclaw-channel': 'client-f-channel',
  'tbs-import-clearance-lcv': 'import-project-clearance',
  'whispertool': 'whisper-tool',
};

/**
 * Sanitize text by replacing client-specific patterns
 */
function sanitize(text: string): string {
  let result = text;
  for (const rule of SANITIZATION_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

// =============================================================================
// Qdrant Config
// =============================================================================

interface QdrantConfig {
  url: string;
  apiKey: string;
  collection: string;
}

function getQdrantConfig(): QdrantConfig | null {
  let apiKey = process.env.QDRANT_API_KEY;
  const url = process.env.QDRANT_CLUSTER_ENDPOINT || "https://api.qdrant.tech";
  const collection = process.env.QDRANT_COLLECTION || "pi-harness-skills";
  
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

function readSkill(dirPath: string): SkillDoc | null {
  const skillPath = join(dirPath, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  try {
    const rawContent = readFileSync(skillPath, "utf-8");
    const fm = parseFrontmatter(rawContent);
    if (!fm) return null;

    // Get original skill name from directory
    const originalName = fm.name || basename(dirPath);
    
    // Sanitize content
    const sanitizedContent = sanitize(rawContent);
    
    // Use name map for known sensitive skill names, otherwise sanitize
    const name = SKILL_NAME_MAP[originalName] || sanitize(originalName);
    
    const description = sanitize(fm.description || "");
    const body = sanitizedContent.replace(/^---[\s\S]*?---\n/, "").trim();
    
    // Text for embedding (sanitized)
    const text = `${name}. ${description}. ${body.slice(0, 1000)}`;

    return {
      id: 0,
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
  
  // Read and sanitize ALL skills
  const skills: SkillDoc[] = [];
  
  for (const dir of skillDirs) {
    const skill = readSkill(dir);
    if (skill) {
      skills.push(skill);
    }
  }
  
  console.error(`[Sync] Found ${skillDirs.length} skills`);
  console.error(`[Sync] All skills sanitized and ready to upload`);

  if (skills.length === 0) {
    console.error("[Sync] No skills to upload.");
    return;
  }

  console.error(`[Sync] Uploading ${skills.length} sanitized skills to Qdrant...`);
  await upsertSkills(client, config.collection, skills);
  console.error(`[Sync] Complete! ${skills.length} sanitized skills uploaded.`);
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
Sync Skills to Qdrant (Sanitized)
──────────────────────────────────
Upload skills to Qdrant for team sharing.
Client-specific names are REPLACED with placeholders.

Sanitization Rules:
  inpac         → [Client A]
  m-capital     → [Client A]
  digisoft      → [Client B]
  cloudshot     → [Client C]
  paperclip     → [Client D]
  teamw         → [Client E]
  openclaw      → [Client F]
  autoresearch  → [Internal Tool]

Usage:
  bun scripts/sync-to-qdrant.ts --from <dir>     Sync skills from directory
  bun scripts/sync-to-qdrant.ts --from <dir> --clear  Clear and re-upload
  bun scripts/sync-to-qdrant.ts --list            List skills in Qdrant
  bun scripts/sync-to-qdrant.ts --search <query>  Search skills in Qdrant
  bun scripts/sync-to-qdrant.ts --help            Show this help

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

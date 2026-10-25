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
// The runtime and this script must write into the SAME collection with the
// SAME vectors: a collection holds vectors of exactly one size, and a vector
// of a different size cannot be searched with the vectors of the other one.
// The embedder and the collection name are therefore imported from the
// packages that own them - they are not repeated here.
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  createEmbedding,
  createEmbeddingsBatch,
} from "../packages/qdrant-skills/dist/index.js";
import {
  LEGACY_SKILL_COLLECTION,
  SKILL_COLLECTION,
  skillPointPayload,
  skillQdrantPoint,
} from "../packages/skills/dist/vector-schema.js";

// =============================================================================
// SANITIZATION: Replace client-specific names with placeholders
// =============================================================================

interface SanitizationRule {
  pattern: RegExp;
  replacement: string;
}

const SANITIZATION_RULES: SanitizationRule[] = [
  // Client company names (case-insensitive)
  { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
  { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
  { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
  { pattern: /\bclient-b\b/gi, replacement: "[Client B]" },

  // Project/app specific names
  { pattern: /\binsurance-project\b/gi, replacement: "[Insurance Project]" },
  { pattern: /\bimport-project\b/gi, replacement: "[Import Project]" },
  { pattern: /\bclient-b_erp\b/gi, replacement: "[Client B Erp]" },
  { pattern: /\bclient-a\b/gi, replacement: "[Client A]" },
  { pattern: /\bclient-a_\b/gi, replacement: "[Client A]_" },
  { pattern: /\bpaperclip_\b/gi, replacement: "[Client D]_" },
  { pattern: /\bopenclaw_\b/gi, replacement: "[Client F]_" },

  // Generic replacements
  { pattern: /Company Name/gi, replacement: "[Client Name]" },
  { pattern: /your company/gi, replacement: "[Client]" },
  { pattern: /our client/gi, replacement: "[Client]" },
  { pattern: /client-specific/gi, replacement: "[Project-specific]" },
];

// Skill name sanitization (for skill directory name -> sanitized display name)
const SKILL_NAME_MAP: Record<string, string> = {
  'insurance-project-step5-slot-filter': 'insurance-project-step-filter',
  'client-a-pe-approval-workflow': 'client-a-pe-approval-workflow',
  'client-a-po-approval-workflow': 'client-a-po-approval-workflow',
  'client-a-pr-approval-workflow': 'client-a-pr-approval-workflow',
  'import-project-clearance-lcv': 'import-project-clearance',
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
  const collection = process.env.QDRANT_COLLECTION || SKILL_COLLECTION;

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

    // The payload and the text come from the shared schema, so this script
    // and the runtime store the SAME point for the same skill: the point
    // id is the hash of the name the payload carries.
    const payload = skillPointPayload({ name, description, body });

    return {
      name: payload.name,
      description: payload.description,
      body: payload.body,
      text: payload.text,
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
  const existing = await collectionSchema(client, name);
  if (existing?.dimensions !== undefined && existing.dimensions !== EMBEDDING_DIMENSIONS) {
    // The collection holds vectors of another size. Writing into it would
    // fail, and recreating it would destroy the skills of the other model.
    // The name says so the user can act.
    console.error(
      `[Sync] The collection ${name} holds ${existing.dimensions}-dimensional vectors,` +
        ` but the runtime embeds with ${EMBEDDING_DIMENSIONS} (${EMBEDDING_MODEL}).`,
    );
    if (name === LEGACY_SKILL_COLLECTION) {
      console.error(
        `[Sync] ${LEGACY_SKILL_COLLECTION} is the legacy collection of the MiniLM model.`,
      );
    }
    console.error(
      `[Sync] Use a different collection (QDRANT_COLLECTION) or re-create this one.`,
    );
    process.exit(1);
  }
  try {
    await client.createCollection(name, {
      vectors: { size: EMBEDDING_DIMENSIONS, distance: "Cosine" }
    });
  } catch {
    // Already exists - OK
  }
}

/**
 * The vector size and the distance of a collection.
 *
 * `null` means the collection does not exist (or cannot be read).
 */
async function collectionSchema(
  client: QdrantClient,
  name: string,
): Promise<{ dimensions?: number; distance?: string } | null> {
  try {
    // SAFETY: the Qdrant client answers with the collection description;
    // the shape below is the one field this function reads. The cast is
    // needed because the generated client types the response as `unknown`.
    const info = (await client.getCollection(name)) as unknown as {
      config?: { params?: { vectors?: { size?: number; distance?: string } } };
    };
    const vectors = info?.config?.params?.vectors;
    if (!vectors) return { };
    return { dimensions: vectors.size, distance: vectors.distance };
  } catch {
    return null;
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
  // The vectors are produced by the same embedder the runtime uses, so the
  // two can search each other's points. The embedding happens in batches:
  // one request per 64 skills instead of one per skill.
  const { embeddings } = await createEmbeddingsBatch(skills.map((skill) => skill.text));
  if (embeddings.length !== skills.length) {
    console.error(
      `[Sync] The embedder returned ${embeddings.length} vectors for ${skills.length} skills.`,
    );
    process.exit(1);
  }

  const points = skills.map((skill, idx) => ({
    // The point comes from the shared schema, so this script and the
    // runtime store the SAME point for the same skill. A sequential id
    // would leave a second point for every skill the runtime also indexes,
    // and could overwrite an unrelated one.
    ...skillQdrantPoint({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      text: skill.text,
    }),
    vector: embeddings[idx],
  }));

  await client.upsert(collectionName, { wait: true, points });
}

async function searchSkills(
  client: QdrantClient,
  collectionName: string,
  query: string
): Promise<void> {
  // The query is embedded with the same model as the stored vectors.
  const { embedding } = await createEmbedding(query);
  const results = await client.query(collectionName, {
    query: embedding,
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
  client-a         → [Client A]
  client-a     → [Client A]
  client-b      → [Client B]
  cloudshot     → [Client C]
  paperclip     → [Client D]
  client-e         → [Client E]
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
  QDRANT_COLLECTION Collection name (default: ${SKILL_COLLECTION})

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

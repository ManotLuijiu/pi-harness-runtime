#!/usr/bin/env bun
/**
 * Qdrant Real Skills E2E Test
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";

// Load env
const envPath = join(process.cwd(), ".env.test");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join("=").trim();
    }
  }
}

const config = {
  url: process.env.QDRANT_CLUSTER_ENDPOINT || "https://api.qdrant.tech",
  apiKey: process.env.QDRANT_API_KEY || "",
  collection: "moocoding-skills-test",
};

console.error("=== Qdrant Real Skills Test ===\n");
console.error(`URL: ${config.url}`);
console.error("");

// Create client - use host:port format
const urlParts = config.url.match(/https?:\/\/([^:]+)(?::(\d+))?/);
const host = urlParts?.[1] || config.url;
const port = parseInt(urlParts?.[2] || "6333");

const client = new QdrantClient({ host, port, apiKey: config.apiKey });

interface SkillDoc {
  id: number;
  name: string;
  description: string;
  body: string;
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

function readSkills(sourceDir: string): SkillDoc[] {
  const skills: SkillDoc[] = [];
  let id = 1;
  const entries = readdirSync(sourceDir);
  for (const entry of entries) {
    if (skills.length >= 10) break;
    const path = join(sourceDir, entry);
    if (!statSync(path).isDirectory()) continue;
    const skillPath = join(path, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf-8");
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    skills.push({
      id: id++,
      name: fm.name || entry,
      description: fm.description || "",
      body: content.replace(/^---[\s\S]*?---\n/, "").trim().slice(0, 2000)
    });
  }
  return skills;
}

async function main() {
  let passed = 0;
  let failed = 0;

  // 1. Create collection
  console.error("[1] Creating collection...");
  try {
    await client.createCollection(config.collection, {
      vectors: { size: 384, distance: "Cosine" }
    });
    console.error("✓ Created\n");
    passed++;
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      console.error("✓ Already exists\n");
      passed++;
    } else {
      console.error("✗ Failed:", err, "\n");
      failed++;
    }
  }

  // 2. Read skills
  console.error("[2] Reading skills...");
  let skills: SkillDoc[] = [];
  try {
    skills = readSkills("/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills");
    console.error(`✓ Read ${skills.length} skills:\n`);
    for (const s of skills) {
      console.error(`  - ${s.name}`);
    }
    console.error("");
    passed++;
  } catch (err) {
    console.error("✗ Failed:", err, "\n");
    failed++;
  }

  // 3. Upload
  console.error("[3] Uploading skills...");
  try {
    const points = skills.map(s => ({
      id: s.id,
      payload: { name: s.name, description: s.description, body: s.body },
      vector: {
        text: `${s.name}. ${s.description}. ${s.body.slice(0, 500)}`,
        model: "sentence-transformers/all-MiniLM-L6-v2"
      }
    }));
    await client.upsert(config.collection, { wait: true, points });
    console.error(`✓ Uploaded ${points.length} skills\n`);
    passed++;
  } catch (err) {
    console.error("✗ Failed:", err, "\n");
    failed++;
  }

  // 4. Search
  console.error("[4] Searching for 'frappe permissions'...");
  try {
    const results = await client.query(config.collection, {
      query: {
        text: "frappe permissions",
        model: "sentence-transformers/all-MiniLM-L6-v2"
      },
      limit: 5,
      with_payload: true  // Request full payload
    } as Parameters<typeof client.query>[1]);
    const points = (results as { points?: unknown[] })?.points || [];
    console.error(`Found ${points.length} results:\n`);
    for (const r of points as Array<{ id: number; score: number; payload?: Record<string, unknown> }>) {
      const name = (r.payload?.name as string) || `id-${r.id}`;
      console.error(`[${(r.score * 100).toFixed(1)}%] ${name}`);
      if (r.payload?.description) {
        console.error(`   ${(r.payload.description as string).slice(0, 60)}...`);
      }
    }
    console.error("\n✓ Search completed\n");
    passed++;
  } catch (err) {
    console.error("✗ Failed:", err, "\n");
    failed++;
  }

  // 5. Cleanup
  console.error("[5] Cleanup...");
  try {
    await client.deleteCollection(config.collection);
    console.error("✓ Deleted\n");
    passed++;
  } catch (err) {
    console.error("⚠ Warning:", err, "\n");
  }

  console.error("=== Summary ===");
  console.error(`Passed: ${passed}`);
  console.error(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

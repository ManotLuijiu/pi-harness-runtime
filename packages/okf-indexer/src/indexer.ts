/**
 * OKF Indexer (RFC-0106)
 *
 * Parses SKILL.md files and extracts structured knowledge for
 * indexing into TencentDB-Agent-Memory CodeGraph.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";

/**
 * OKF Document structure
 */
export interface OKFDocument {
  id: string;
  title: string;
  slug: string;
  sections: OKFSection[];
  links: string[];
  metadata: OKFMetadata;
}

export interface OKFSection {
  id: string;
  title: string;
  content: string;
  level: number;
  bullets: string[];
}

export interface OKFMetadata {
  source: string;
  tags: string[];
  created: string;
  updated: string;
  scope?: string;
}

/**
 * Parse frontmatter from SKILL.md
 */
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      result[key] = val.slice(1, -1).split(",").map((s) => s.trim());
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Extract markdown sections
 */
function extractSections(content: string): OKFSection[] {
  const sections: OKFSection[] = [];
  const lines = content.split("\n");
  let current: Partial<OKFSection> | null = null;
  let bodyLines: string[] = [];

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);

    if (h2 || h3) {
      if (current && current.title) {
        sections.push({
          id: current.id!,
          title: current.title,
          content: bodyLines.join("\n").trim(),
          level: current.level!,
          bullets: bodyLines.filter((l) => l.trim().startsWith("- ")).map((l) => l.replace(/^-\s*/, "").trim()),
        });
      }
      current = {
        id: (h2 || h3)![1].toLowerCase().replace(/\s+/g, "-"),
        title: (h2 || h3)![1],
        level: h2 ? 2 : 3,
      };
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }

  if (current && current.title) {
    sections.push({
      id: current.id!,
      title: current.title,
      content: bodyLines.join("\n").trim(),
      level: current.level!,
      bullets: bodyLines.filter((l) => l.trim().startsWith("- ")).map((l) => l.replace(/^-\s*/, "").trim()),
    });
  }

  return sections;
}

/**
 * Extract wiki-style links
 */
function extractLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = regex.exec(content)) !== null) links.push(m[1]);
  return [...new Set(links)];
}

/**
 * Index a single SKILL.md file
 */
export function indexSkill(filePath: string, basePath: string): OKFDocument | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    const sections = extractSections(content);
    const links = extractLinks(content);
    const name = basename(filePath, ".md");

    return {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      title: (fm.name as string) || name,
      slug: name,
      sections,
      links,
      metadata: {
        source: relative(basePath, filePath),
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        created: (fm.created as string) || new Date().toISOString(),
        updated: new Date().toISOString(),
        scope: fm.scope as string,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Index all skills in a directory
 */
export function indexDirectory(dirPath: string): OKFDocument[] {
  const docs: OKFDocument[] = [];

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) {
        const doc = indexSkill(full, dirPath);
        if (doc) docs.push(doc);
      }
    }
  }

  walk(dirPath);
  return docs;
}

/**
 * Convert OKF document to CodeGraph nodes/edges for TencentDB
 */
export function toCodeGraph(doc: OKFDocument): {
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; type: string }>;
} {
  const nodes = [
    { id: doc.id, type: "skill", data: { title: doc.title, slug: doc.slug, source: doc.metadata.source } },
    ...doc.sections.map((s) => ({ id: `${doc.id}#${s.id}`, type: "section", data: { title: s.title, level: s.level } })),
  ];

  const edges = doc.sections.map((s) => ({ from: doc.id, to: `${doc.id}#${s.id}`, type: "has_section" }));
  edges.push(...doc.links.map((l) => ({ from: doc.id, to: l.toLowerCase().replace(/\s+/g, "-"), type: "links_to" })));

  return { nodes, edges };
}

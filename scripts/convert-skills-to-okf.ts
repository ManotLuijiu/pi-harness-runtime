#!/usr/bin/env bun
/**
 * Skills to OKF Converter
 * 
 * Converts frappe-bench skills to OKF format for pi-harness-runtime
 * - Sanitizes sensitive info (IPs, URLs, API keys)
 * - Converts to OKF markdown format
 * - Preserves procedures and best practices
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

const SOURCE_DIR = "/home/frappe/frappe-bench/.claude-plugins/moocoding-skills/skills";
const OUTPUT_DIR = "./OKF/skills";

// Sensitive patterns to sanitize
const SANITIZE_PATTERNS: [RegExp, string][] = [
  // IP addresses
  [/(\b\d{1,3}\.){3}\d{1,3}\b/g, "{IP}"],
  // Specific domains (high priority - before generic)
  [/grist\.bunchee\.online/gi, "{GRIST_DOMAIN}"],
  [/(https?:\/\/)?[\w.-]+\.(bunchee\.online|hetzner\.com|digitalocean\.com)/gi, "{DOMAIN}"],
  // API keys (generic pattern - 32+ chars)
  [/(?<![a-zA-Z0-9])[a-zA-Z0-9]{32,}(?![a-zA-Z0-9])/g, "{API_KEY}"],
  // Bearer tokens
  [/Bearer [a-zA-Z0-9._-]+/g, "Bearer {TOKEN}"],
  // NPM tokens
  [/npm_[a-zA-Z0-9]{36}/gi, "npm_{TOKEN}"],
  // Frappe sites
  [/frappe-bench\/sites\/[\w.-]+/g, "frappe-bench/sites/{SITE}"],
  // Server paths
  [/\/home\/frappe\/[\w-]+/g, "/home/{USER}"],
];

interface SkillMetadata {
  name: string;
  description: string;
  scope?: string;
}

function sanitize(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SANITIZE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function parseSkillMetadata(content: string): SkillMetadata | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  const scopeMatch = content.match(/^scope:\s*(.+)$/m);
  
  if (!nameMatch || !descMatch) return null;
  
  return {
    name: sanitize(nameMatch[1].trim()),
    description: sanitize(descMatch[1].trim()),
    scope: scopeMatch?.[1]?.trim(),
  };
}

function convertToOKF(skillPath: string, content: string): string {
  const metadata = parseSkillMetadata(content);
  if (!metadata) return "";
  
  const sanitized = sanitize(content);
  
  // Convert YAML frontmatter to OKF header
  let okf = `# ${metadata.name}\n\n`;
  okf += `## Overview\n\n`;
  okf += `${metadata.description}\n\n`;
  
  // Extract key sections
  const sections = extractSections(sanitized);
  
  for (const [title, body] of Object.entries(sections)) {
    okf += `## ${title}\n\n`;
    okf += body.trim() + "\n\n";
  }
  
  // Add provenance
  okf += `---\n\n`;
  okf += `**Source:** ${skillPath}\n`;
  okf += `**Scope:** ${metadata.scope || "global"}\n`;
  okf += `**Converted:** ${new Date().toISOString().split("T")[0]}\n`;
  
  return okf;
}

function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");
  let currentSection = "Details";
  let currentBody: string[] = [];
  
  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    const h3Match = line.match(/^### (.+)$/);
    
    if (h2Match) {
      if (currentBody.length > 0) {
        sections[currentSection] = currentBody.join("\n");
      }
      currentSection = h2Match[1];
      currentBody = [];
    } else if (h3Match) {
      currentBody.push(`### ${h3Match[1]}`);
    } else if (!line.startsWith("---") && !line.match(/^name:|^description:|^scope:/)) {
      currentBody.push(line);
    }
  }
  
  if (currentBody.length > 0) {
    sections[currentSection] = currentBody.join("\n");
  }
  
  return sections;
}

async function convertSkills(): Promise<void> {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }
  
  const skillDirs = await readdir(SOURCE_DIR);
  let converted = 0;
  let skipped = 0;
  
  for (const dir of skillDirs) {
    const skillFile = `${SOURCE_DIR}/${dir}/SKILL.md`;
    
    if (!existsSync(skillFile)) {
      skipped++;
      continue;
    }
    
    try {
      const content = await readFile(skillFile, "utf-8");
      const okfContent = convertToOKF(skillFile, content);
      
      if (okfContent) {
        const outputPath = `${OUTPUT_DIR}/${dir}.md`;
        await writeFile(outputPath, okfContent);
        console.log(`✅ Converted: ${dir}`);
        converted++;
      } else {
        console.log(`⚠️ Skipped (no metadata): ${dir}`);
        skipped++;
      }
    } catch (err) {
      console.error(`❌ Error converting ${dir}:`, err);
      skipped++;
    }
  }
  
  console.log(`\n📊 Results: ${converted} converted, ${skipped} skipped`);
}

convertSkills();

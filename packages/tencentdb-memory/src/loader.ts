/**
 * Skill Loader (RFC-0105)
 *
 * Loads and parses SKILL.md files from local skills directory.
 * Converts to SkillMetadata for sync to TencentDB server.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import type { SkillMetadata } from "./types.js";

/**
 * Parse SKILL.md frontmatter
 */
function parseFrontmatter(content: string): Record<string, unknown> {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) {
		return {};
	}
	const yaml = match[1];
	const result: Record<string, unknown> = {};

	// Simple YAML parser for our format
	for (const line of yaml.split("\n")) {
		const colonIndex = line.indexOf(":");
		if (colonIndex > 0) {
			const key = line.slice(0, colonIndex).trim();
			let value: string | string[] = line.slice(colonIndex + 1).trim();
			// Handle array values (hyphen format)
			if (value.startsWith("[") && value.endsWith("]")) {
				value = value
					.slice(1, -1)
					.split(",")
					.map((v) => v.trim());
			}
			result[key] = value;
		}
	}
	return result;
}

/**
 * Extract section content
 */
function extractSection(
	content: string,
	sectionName: string,
): string[] | undefined {
	const pattern = new RegExp(
		`^##\\s+${sectionName}[^#]*\\n([\\s\\S]*?)(?=^##\\s|\\n---)`,
		"im",
	);
	const match = content.match(pattern);
	if (match) {
		// Extract bullet points
		return match[1]
			.split("\n")
			.filter((line) => line.trim().startsWith("- "))
			.map((line) => line.replace(/^-\s*/, "").trim());
	}
	return undefined;
}

/**
 * Load a single SKILL.md file
 */
export function loadSkill(
	filePath: string,
	basePath: string,
): SkillMetadata | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		const stats = statSync(filePath);
		const frontmatter = parseFrontmatter(content);

		// Extract sections
		const whenToUse = extractSection(content, "When to Use");
		const procedureSteps = extractSection(content, "Procedure");
		const pitfalls = extractSection(content, "Pitfalls");
		const verificationSteps = extractSection(content, "Verification");

		// Extract tags from frontmatter or content
		const tags = (frontmatter.tags as string[]) || frontmatter.tag
			? [(frontmatter.tag || frontmatter.tags) as string].flat()
			: [];

		// Extract related skills
		const relatedSkills = extractSection(content, "Related Skills");

		const name = basename(filePath, ".md");

		return {
			name,
			description: (frontmatter.description as string) || "",
			whenToUse: whenToUse?.join("\n"),
			procedureSteps,
			pitfalls,
			verificationSteps,
			relatedSkills,
			tags,
			sourcePath: relative(basePath, filePath),
			lastModified: stats.mtime.toISOString(),
		};
	} catch (error) {
		console.error(`Failed to load skill from ${filePath}:`, error);
		return null;
	}
}

/**
 * Recursively load all skills from a directory
 */
export function loadSkillsFromDirectory(dirPath: string): SkillMetadata[] {
	const skills: SkillMetadata[] = [];

	function walkDirectory(currentPath: string): void {
		const entries = readdirSync(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(currentPath, entry.name);

			if (entry.isDirectory()) {
				// Recurse into subdirectories
				walkDirectory(fullPath);
			} else if (entry.name === "SKILL.md" || entry.name.endsWith(".md")) {
				const skill = loadSkill(fullPath, dirPath);
				if (skill) {
					skills.push(skill);
				}
			}
		}
	}

	walkDirectory(dirPath);
	return skills;
}

/**
 * Load skills from multiple directories
 */
export function loadSkillsFromDirectories(
	dirPaths: string[],
): SkillMetadata[] {
	const allSkills: SkillMetadata[] = [];
	for (const dirPath of dirPaths) {
		const skills = loadSkillsFromDirectory(dirPath);
		allSkills.push(...skills);
	}
	return allSkills;
}

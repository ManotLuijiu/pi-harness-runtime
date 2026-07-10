/**
 * Rule Discovery
 *
 * Discovers and parses project rules from AGENTS.md, RULES.md, etc.
 */

import { readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import type { ProjectRule, RuleSection, RulePriority } from "./types.js";

/**
 * Rule file metadata.
 */
export interface RuleFile {
	/** Absolute path to rule file */
	path: string;
	/** File name without path */
	name: string;
	/** Parsed content */
	content: string;
	/** Whether user explicitly created this file */
	userDefined: boolean;
}

/**
 * Priority mapping from file names.
 */
const PRIORITY_MAP: Record<string, RulePriority> = {
	"AGENTS.md": "mandatory",
	"CLAUDE.md": "mandatory",
	".claude.md": "mandatory",
	"RULES.md": "mandatory",
	"PROJECT_RULES.md": "mandatory",
	"CONTRIBUTING.md": "advisory",
};

/**
 * Parse markdown content into rule sections.
 */
function parseMarkdownSections(
	content: string,
	filePath: string,
): RuleSection[] {
	const sections: RuleSection[] = [];
	const lines = content.split("\n");

	let currentSection: RuleSection | null = null;
	let currentContent: string[] = [];
	let lineNumber = 0;

	for (const line of lines) {
		lineNumber++;

		// Check for heading
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			// Save previous section
			if (currentSection) {
				currentSection.content = currentContent.join("\n").trim();
				sections.push(currentSection);
			}

			// Start new section
			currentSection = {
				id: `section-${sections.length + 1}`,
				title: headingMatch[2].trim(),
				content: "",
				line: lineNumber,
			};
			currentContent = [];
		} else if (currentSection) {
			currentContent.push(line);
		}
	}

	// Save last section
	if (currentSection) {
		currentSection.content = currentContent.join("\n").trim();
		sections.push(currentSection);
	}

	return sections;
}

/**
 * Parse a rule file and extract structured content.
 */
export async function parseRuleFile(file: RuleFile): Promise<ProjectRule> {
	const sections = parseMarkdownSections(file.content, file.path);
	const priority = PRIORITY_MAP[file.name] || "advisory";

	return {
		id: `rule-${basename(file.path, ".md")}`,
		source: file.path,
		priority,
		content: file.content,
		sections,
		userDefined: file.userDefined,
	};
}

/**
 * Discover rule files in a repository.
 */
export async function discoverRuleFiles(
	rootPath: string,
	fs: {
		exists(path: string): Promise<boolean>;
		readFile(path: string): Promise<string>;
		readDir(path: string): Promise<string[]>;
		isDirectory(path: string): Promise<boolean>;
	},
	fileNames: string[] = [
		"AGENTS.md",
		"RULES.md",
		"PROJECT_RULES.md",
		"CONTRIBUTING.md",
		".claude.md",
		"CLAUDE.md",
	],
): Promise<RuleFile[]> {
	const rules: RuleFile[] = [];

	// Check for rules at root level
	for (const fileName of fileNames) {
		const filePath = join(rootPath, fileName);
		try {
			if (await fs.exists(filePath)) {
				const content = await fs.readFile(filePath);
				rules.push({
					path: filePath,
					name: fileName,
					content,
					userDefined: true,
				});
			}
		} catch {
			// File might not be readable, skip
		}
	}

	// Check for rules in .github/ or docs/ directories
	const subdirs = [".github", "docs", ".claude"];
	for (const subdir of subdirs) {
		const subdirPath = join(rootPath, subdir);
		try {
			if (await fs.isDirectory(subdirPath)) {
				const entries = await fs.readDir(subdirPath);
				for (const entry of entries) {
					if (entry.endsWith(".md") || entry.endsWith(".txt")) {
						const filePath = join(subdirPath, entry);
						try {
							const content = await fs.readFile(filePath);
							rules.push({
								path: filePath,
								name: entry,
								content,
								userDefined: false,
							});
						} catch {
							// Skip unreadable files
						}
					}
				}
			}
		} catch {
			// Directory not accessible, skip
		}
	}

	return rules;
}

/**
 * Merge multiple rule files into a coherent set.
 * Later rules override earlier ones for conflicting sections.
 */
export function mergeRules(
	ruleFiles: RuleFile[],
	prioritizeUserDefined = true,
): ProjectRule[] {
	// Sort by priority and user-defined status
	const sorted = [...ruleFiles].sort((a, b) => {
		if (prioritizeUserDefined) {
			if (a.userDefined !== b.userDefined) {
				return a.userDefined ? -1 : 1;
			}
		}
		const priorityA = PRIORITY_MAP[a.name] || "advisory";
		const priorityB = PRIORITY_MAP[b.name] || "advisory";
		const priorityOrder: Record<RulePriority, number> = {
			mandatory: 0,
			advisory: 1,
			convention: 2,
		};
		return priorityOrder[priorityA] - priorityOrder[priorityB];
	});

	// Parse and return rules
	return sorted.map((file) => ({
		id: `rule-${basename(file.path, ".md")}`,
		source: file.path,
		priority: PRIORITY_MAP[file.name] || "advisory",
		content: file.content,
		sections: parseMarkdownSections(file.content, file.path),
		userDefined: file.userDefined,
	}));
}

/**
 * Extract commands from rules.
 * Looks for command patterns like `npm run`, `bun test`, etc.
 */
export function extractCommandsFromRules(rules: ProjectRule[]): {
	permitted: string[];
	prohibited: string[];
} {
	const permitted: string[] = [];
	const prohibited: string[] = [];

	const commandPattern = /`([^`]+)`/g;
	const permitPattern = /permi(ted|ssion)|allow|can\s+run|may\s+execute/i;
	const prohibitPattern =
		/prohibit|forbid|deny|block|cannot\s+run|may\s+not\s+execute/i;

	for (const rule of rules) {
		const fullText = rule.content;

		// Check if this rule is about permitting or prohibiting
		const isPermit = permitPattern.test(fullText);
		const isProhibit = prohibitPattern.test(fullText);

		let match;
		while ((match = commandPattern.exec(fullText)) !== null) {
			const command = match[1].trim();
			if (isPermit) {
				if (!permitted.includes(command)) {
					permitted.push(command);
				}
			}
			if (isProhibit) {
				if (!prohibited.includes(command)) {
					prohibited.push(command);
				}
			}
		}
	}

	return { permitted, prohibited };
}

/**
 * Extract key-value metadata from rules.
 */
export function extractMetadataFromRules(
	rules: ProjectRule[],
): Record<string, string> {
	const metadata: Record<string, string> = {};

	for (const rule of rules) {
		for (const section of rule.sections) {
			// Look for key: value patterns
			const kvPattern = /^\*\*([^*]+):\*\*\s*(.+)$/gm;
			let match;
			while ((match = kvPattern.exec(section.content)) !== null) {
				const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
				const value = match[2].trim();
				metadata[key] = value;
			}

			// Also check for list items with key: value
			const listPattern = /^- \*\*([^*]+):\*\*\s*(.+)$/gm;
			while ((match = listPattern.exec(section.content)) !== null) {
				const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
				const value = match[2].trim();
				metadata[key] = value;
			}
		}
	}

	return metadata;
}

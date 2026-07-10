/**
 * Command Discovery
 *
 * Discovers project commands from package.json, pyproject.toml, and other config files.
 */

import type { ProjectCommands, PackageManagerType } from "./types.js";

/**
 * Discovered command entry.
 */
export interface DiscoveredCommand {
	/** Command string */
	command: string;
	/** Source file path */
	source: string;
	/** Whether this is a primary command */
	primary: boolean;
}

/**
 * Parse npm/yarn/pnpm scripts from package.json.
 */
export function parsePackageJsonScripts(
	packageJson: Record<string, unknown>,
): DiscoveredCommand[] {
	const commands: DiscoveredCommand[] = [];
	const scripts = packageJson.scripts as Record<string, string> | undefined;

	if (!scripts || typeof scripts !== "object") {
		return commands;
	}

	const primaryScripts = [
		"test",
		"build",
		"dev",
		"start",
		"lint",
		"typecheck",
		"format",
	];

	for (const [name, script] of Object.entries(scripts)) {
		if (typeof script !== "string") continue;

		commands.push({
			command: `npm run ${name}`,
			source: "package.json",
			primary: primaryScripts.includes(name),
		});

		// Also add yarn/pnpm equivalents
		if (script.includes("&&") || script.includes("||")) {
			// Compound script - might need different runner
		}
	}

	return commands;
}

/**
 * Parse Python scripts from pyproject.toml or setup.py.
 */
export function parsePythonCommands(content: string): DiscoveredCommand[] {
	const commands: DiscoveredCommand[] = [];

	// Check for pytest configuration
	if (content.includes("[tool.pytest") || content.includes("[pytest]")) {
		commands.push({
			command: "pytest",
			source: "pyproject.toml",
			primary: true,
		});
	}

	// Check for coverage
	if (content.includes("coverage")) {
		commands.push({
			command: "coverage run -m pytest",
			source: "pyproject.toml",
			primary: false,
		});
		commands.push({
			command: "coverage report",
			source: "pyproject.toml",
			primary: false,
		});
	}

	return commands;
}

/**
 * Categorize commands by type.
 */
export function categorizeCommands(
	commands: DiscoveredCommand[],
): ProjectCommands {
	const categorized: ProjectCommands = {
		unitTest: [],
		integrationTest: [],
		e2eTest: [],
		lint: [],
		typecheck: [],
		build: [],
		migrate: [],
	};

	// Patterns for categorizing
	const patterns: {
		category: keyof ProjectCommands;
		pattern: RegExp;
	}[] = [
		// Test patterns
		{ category: "unitTest", pattern: /\btest\b/i },
		{ category: "unitTest", pattern: /\bvitest\b/i },
		{ category: "unitTest", pattern: /\bjest\b/i },
		{ category: "unitTest", pattern: /\bpytest\b/i },
		{ category: "unitTest", pattern: /\bbun\s+test\b/i },
		{ category: "integrationTest", pattern: /\bintegration\b/i },
		{ category: "e2eTest", pattern: /\be2e\b/i },
		{ category: "e2eTest", pattern: /\bplaywright\b/i },
		{ category: "e2eTest", pattern: /\bcypress\b/i },

		// Lint patterns
		{ category: "lint", pattern: /\blint\b/i },
		{ category: "lint", pattern: /\beslint\b/i },
		{ category: "lint", pattern: /\bprettier\b/i },
		{ category: "lint", pattern: /\bruff\b/i },
		{ category: "lint", pattern: /\bflake8\b/i },
		{ category: "lint", pattern: /\bmypy\b/i },

		// Typecheck patterns
		{ category: "typecheck", pattern: /\btypecheck\b/i },
		{ category: "typecheck", pattern: /\btsc\b.*--noEmit/i },
		{ category: "typecheck", pattern: /\bmypy\b/i },

		// Build patterns
		{ category: "build", pattern: /\bbuild\b/i },
		{ category: "build", pattern: /\bwebpack\b/i },
		{ category: "build", pattern: /\bvite\s+build\b/i },
		{ category: "build", pattern: /\bnext\s+build\b/i },
		{ category: "build", pattern: /\brollup\b/i },
		{ category: "build", pattern: /\besbuild\b/i },

		// Migrate patterns
		{ category: "migrate", pattern: /\bmigrate\b/i },
		{ category: "migrate", pattern: /\balembic\b/i },
		{ category: "migrate", pattern: /\bbench\s+migrate\b/i },
	];

	for (const cmd of commands) {
		for (const { category, pattern } of patterns) {
			if (pattern.test(cmd.command)) {
				if (!categorized[category].includes(cmd.command)) {
					categorized[category].push(cmd.command);
				}
				break;
			}
		}
	}

	return categorized;
}

/**
 * Determine the primary package manager from project files.
 */
export function detectPackageManager(
	files: string[],
): PackageManagerType | null {
	const managerSignals: Record<PackageManagerType, string[]> = {
		npm: ["package.json", "package-lock.json"],
		yarn: ["yarn.lock"],
		pnpm: ["pnpm-lock.yaml"],
		bun: ["bun.lockb", "BUN.lockb"],
		pip: ["requirements.txt", "Pipfile"],
		poetry: ["pyproject.toml", "poetry.lock"],
		bench: ["apps.txt", "sites/", "frappe-bench.yaml"],
	};

	const scores: Record<PackageManagerType, number> = {
		npm: 0,
		yarn: 0,
		pnpm: 0,
		bun: 0,
		pip: 0,
		poetry: 0,
		bench: 0,
	};

	for (const file of files) {
		const fileName = file.split("/").pop() || file;
		for (const [manager, patterns] of Object.entries(managerSignals)) {
			for (const pattern of patterns) {
				if (fileName === pattern || file.endsWith(pattern)) {
					scores[manager as PackageManagerType]++;
				}
			}
		}
	}

	// Find highest score
	let best: PackageManagerType | null = null;
	let bestScore = 0;
	for (const [manager, score] of Object.entries(scores)) {
		if (score > bestScore) {
			bestScore = score;
			best = manager as PackageManagerType;
		}
	}

	return best;
}

/**
 * Parse composer.json scripts for Laravel/PHP.
 */
export function parseComposerScripts(
	composerJson: Record<string, unknown>,
): DiscoveredCommand[] {
	const commands: DiscoveredCommand[] = [];
	const scripts = composerJson.scripts as Record<string, unknown> | undefined;

	if (!scripts || typeof scripts !== "object") {
		return commands;
	}

	for (const [name] of Object.entries(scripts)) {
		commands.push({
			command: `composer ${name}`,
			source: "composer.json",
			primary: name === "test" || name === "lint",
		});
	}

	return commands;
}

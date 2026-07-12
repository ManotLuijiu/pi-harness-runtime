/**
 * Project Analyzer
 *
 * Main analyzer implementation that orchestrates project analysis.
 */

import { readFile } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { execSync } from "node:child_process";

import type {
	ProjectProfile,
	AnalyzeRequest,
	AnalyzeResult,
	AnalysisErrorCode,
	DetectedFramework,
	DetectedLanguage,
	FrameworkAnalyzerPlugin,
	ReadonlyFileSystem,
	TestCapability,
	TestRunner,
	WarningCode,
} from "./types.js";

import { FileSystemWalker, createReadonlyFileSystem } from "./walker.js";
import {
	AnalysisCache,
	hashRuleFiles,
	hashManifestFiles,
	hashFrameworkConfigFiles,
} from "./cache.js";
import {
	discoverRuleFiles,
	mergeRules,
	extractCommandsFromRules,
	extractMetadataFromRules,
} from "./rule-discovery.js";
import {
	parsePackageJsonScripts,
	categorizeCommands,
	detectPackageManager,
	parsePythonCommands,
	parseComposerScripts,
} from "./command-discovery.js";
import { GenericFrameworkDetector } from "./signals.js";

// ─── Default Plugins ────────────────────────────────────────────────────

/**
 * Default framework analyzer plugins.
 * These are used when no custom plugins are provided.
 */
export const DEFAULT_PLUGINS: FrameworkAnalyzerPlugin[] = [];

// ─── Language Detection ────────────────────────────────────────────────

/**
 * Language file extensions mapping.
 */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
	TypeScript: [".ts", ".tsx"],
	JavaScript: [".js", ".jsx", ".mjs", ".cjs"],
	Python: [".py"],
	Ruby: [".rb"],
	PHP: [".php"],
	Go: [".go"],
	Rust: [".rs"],
	Java: [".java", ".kt", ".kts"],
	"C#": [".cs"],
	"C++": [".cpp", ".cc", ".cxx", ".h", ".hpp"],
	C: [".c"],
	Swift: [".swift"],
	HTML: [".html", ".htm"],
	CSS: [".css", ".scss", ".sass", ".less"],
	SQL: [".sql"],
	Markdown: [".md", ".mdx"],
};

/**
 * Count language coverage from scanned files.
 */
export function detectLanguages(
	files: { relativePath: string; size: number }[],
): DetectedLanguage[] {
	const counts: Record<string, { files: number; bytes: number }> = {};
	let totalBytes = 0;

	for (const file of files) {
		for (const [lang, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
			for (const langExt of extensions) {
				if (file.relativePath.endsWith(langExt)) {
					counts[lang] = counts[lang] || { files: 0, bytes: 0 };
					counts[lang].files++;
					counts[lang].bytes += file.size;
					totalBytes += file.size;
					break;
				}
			}
		}
	}

	const languages: DetectedLanguage[] = [];
	for (const [lang, data] of Object.entries(counts)) {
		languages.push({
			name: lang,
			coverage: totalBytes > 0 ? data.bytes / totalBytes : 0,
		});
	}

	// Sort by coverage descending
	languages.sort((a, b) => b.coverage - a.coverage);

	return languages;
}

// ─── Test Capability Detection ─────────────────────────────────────────

/**
 * Detect test capabilities from project files.
 */
export async function detectTestCapabilities(
	fs: ReadonlyFileSystem,
	framework: string,
): Promise<TestCapability[]> {
	const capabilities: TestCapability[] = [];

	// Common test runner patterns
	const testRunners: { runner: TestRunner; configFiles: string[] }[] = [
		{
			runner: "vitest",
			configFiles: [
				"vitest.config.ts",
				"vitest.config.js",
				"vitest.config.mts",
			],
		},
		{
			runner: "jest",
			configFiles: [
				"jest.config.js",
				"jest.config.ts",
				"jest.config.json",
				"package.json",
			],
		},
		{
			runner: "playwright",
			configFiles: ["playwright.config.ts", "playwright.config.js"],
		},
		{
			runner: "cypress",
			configFiles: ["cypress.config.ts", "cypress.config.js"],
		},
		{ runner: "bun_test", configFiles: [] }, // Detected via bun.lockb and test scripts
		{
			runner: "pytest",
			configFiles: ["pytest.ini", "setup.cfg", "pyproject.toml"],
		},
		{ runner: "phpunit", configFiles: ["phpunit.xml", "phpunit.xml.dist"] },
		{ runner: "bench_test", configFiles: ["apps.txt", "sites/"] },
	];

	for (const { runner, configFiles } of testRunners) {
		if (configFiles.length === 0) {
			// No config file needed
			const hasPackage = await fs.exists("package.json");
			const hasBunLock = await fs.exists("bun.lockb");

			if (runner === "bun_test" && (hasPackage || hasBunLock)) {
				capabilities.push({
					runner,
					available: true,
					pattern: "*.test.ts",
				});
			}
			continue;
		}

		for (const configFile of configFiles) {
			if (await fs.exists(configFile)) {
				capabilities.push({
					runner,
					configPath: configFile,
					available: true,
				});
				break;
			}
		}
	}

	// Check for bench_test in Frappe
	if (framework === "frappe") {
		const hasAppsTxt = await fs.exists("apps.txt");
		const hasSites = await fs.exists("sites");
		if (hasAppsTxt || hasSites) {
			capabilities.push({
				runner: "bench_test",
				available: true,
			});
		}
	}

	return capabilities;
}

// ─── Main Analyzer ─────────────────────────────────────────────────────

/**
 * Project analyzer implementation.
 */
export class ProjectAnalyzer {
	private cache: AnalysisCache;
	private plugins: FrameworkAnalyzerPlugin[];
	private defaultDetector: GenericFrameworkDetector;

	constructor(
		options: {
			cache?: AnalysisCache;
			plugins?: FrameworkAnalyzerPlugin[];
		} = {},
	) {
		this.cache = options.cache || new AnalysisCache();
		this.plugins = options.plugins || DEFAULT_PLUGINS;
		this.defaultDetector = new GenericFrameworkDetector();
	}

	/**
	 * Get git revision for a repository.
	 */
	private async getGitRevision(rootPath: string): Promise<string> {
		try {
			const revision = execSync("git rev-parse HEAD", {
				cwd: rootPath,
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			return revision;
		} catch {
			return "unknown";
		}
	}

	/**
	 * Parse JSON file safely.
	 */
	private async parseJsonFile<T>(path: string): Promise<T | null> {
		try {
			const content = await readFile(path, "utf-8");
			return JSON.parse(content) as T;
		} catch {
			return null;
		}
	}

	/**
	 * Run framework detection.
	 */
	private async detectFrameworks(
		fs: ReadonlyFileSystem,
	): Promise<{
		frameworks: DetectedFramework[];
		warnings: { code: WarningCode; message: string }[];
	}> {
		const warnings: { code: WarningCode; message: string }[] = [];
		const detectedFrameworks: DetectedFramework[] = [];

		// Try custom plugins first
		const pluginResults: { framework: DetectedFramework; pluginId: string }[] =
			[];

		for (const plugin of this.plugins) {
			try {
				const result = await plugin.detect(fs);
				if (result) {
					pluginResults.push({
						framework: {
							category: result.category,
							name: result.category
								.replace(/_/g, " ")
								.replace(/\b\w/g, (c) => c.toUpperCase()),
							version: result.version,
							confidence: result.confidence,
							signals: result.signals,
							primary: detectedFrameworks.length === 0,
						},
						pluginId: plugin.id,
					});
				}
			} catch {
				// Plugin detection failed, continue
			}
		}

		// If no plugins matched, use generic detector
		if (pluginResults.length === 0) {
			const genericResults = await this.defaultDetector.detect(fs);

			for (const result of genericResults) {
				pluginResults.push({
					framework: {
						category: result.category,
						name: result.category
							.replace(/_/g, " ")
							.replace(/\b\w/g, (c) => c.toUpperCase()),
						version: result.version,
						confidence: result.confidence,
						signals: result.signals,
						primary: detectedFrameworks.length === 0,
					},
					pluginId: "generic",
				});
			}
		}

		// Sort by confidence and add warnings for conflicts
		pluginResults.sort(
			(a, b) => b.framework.confidence - a.framework.confidence,
		);

		for (const result of pluginResults) {
			// Check for conflicting frameworks
			const existingPrimary = detectedFrameworks.find((f) => f.primary);
			if (existingPrimary && result.framework.confidence > 0.5) {
				warnings.push({
					code: "CONFLICTING_FRAMEWORKS",
					message: `Multiple frameworks detected: ${existingPrimary.name} and ${result.framework.name}`,
				});
			}

			detectedFrameworks.push(result.framework);
		}

		if (detectedFrameworks.length === 0) {
			warnings.push({
				code: "NO_FRAMEWORK_DETECTED",
				message: "No specific framework detected, using generic profile",
			});
		}

		return { frameworks: detectedFrameworks, warnings };
	}

	/**
	 * Discover rules from project.
	 */
	private async discoverRules(
		rootPath: string,
		fs: ReadonlyFileSystem,
	): Promise<{
		rules: ReturnType<typeof mergeRules>;
		metadata: Record<string, string>;
	}> {
		const ruleFiles = await discoverRuleFiles(rootPath, fs);
		const rules = mergeRules(ruleFiles);
		const metadata = extractMetadataFromRules(rules);

		return { rules, metadata };
	}

	/**
	 * Discover commands from project.
	 */
	private async discoverCommands(
		rootPath: string,
		_fs: ReadonlyFileSystem,
	): Promise<{
		commands: ReturnType<typeof categorizeCommands>;
		permitted: string[];
		prohibited: string[];
	}> {
		const allCommands: ReturnType<typeof parsePackageJsonScripts> = [];

		// Parse package.json if exists
		const packageJson = await this.parseJsonFile<Record<string, unknown>>(
			join(rootPath, "package.json"),
		);
		if (packageJson) {
			allCommands.push(...parsePackageJsonScripts(packageJson));
		}

		// Parse composer.json if exists
		const composerJson = await this.parseJsonFile<Record<string, unknown>>(
			join(rootPath, "composer.json"),
		);
		if (composerJson) {
			allCommands.push(...parseComposerScripts(composerJson));
		}

		// Parse pyproject.toml if exists
		const pyprojectToml = await this.parseJsonFile<Record<string, unknown>>(
			join(rootPath, "pyproject.toml"),
		);
		if (pyprojectToml) {
			allCommands.push(...parsePythonCommands(JSON.stringify(pyprojectToml)));
		}

		// Categorize commands
		const commands = categorizeCommands(allCommands);

		// Extract permitted/prohibited from rules
		// This is handled separately by rule discovery

		return {
			commands,
			permitted: [],
			prohibited: [],
		};
	}

	/**
	 * Analyze a project.
	 */
	async analyze(request: AnalyzeRequest): Promise<AnalyzeResult> {
		const startTime = Date.now();

		try {
			const rootPath = request.repositoryRoot;

			// Get git revision
			const revision =
				request.revision || (await this.getGitRevision(rootPath));

			// Create filesystem walker
			const walker = new FileSystemWalker(rootPath, request.config);
			const fs = createReadonlyFileSystem(walker);

			// Scan filesystem
			const scanResult = await walker.scan();

			// Try cache first
			const ruleFiles = await discoverRuleFiles(rootPath, fs);
			const ruleHash = await hashRuleFiles(
				ruleFiles.map((f) => ({ path: f.path, content: f.content })),
			);

			const manifestFiles = scanResult.files
				.filter((f) =>
					["package.json", "pyproject.toml", "composer.json"].includes(
						basename(f.path),
					),
				)
				.map((f) => ({
					path: f.path,
					content: walker.readFileSafe(f.path) as Promise<string>,
				}));

			const manifestContents = await Promise.all(
				manifestFiles.map((f) => f.content),
			);
			const manifestHash = await hashManifestFiles(
				manifestFiles.map((f, i) => ({
					path: f.path,
					content: manifestContents[i] || "",
				})),
			);

			const frameworkConfigFiles = scanResult.files
				.filter(
					(f) =>
						f.relativePath.includes("config") ||
						[
							"next.config.js",
							"vite.config.ts",
							"tsconfig.json",
							"webpack.config.js",
						].some((c) => f.relativePath.endsWith(c)),
				)
				.map((f) => ({
					path: f.path,
					content: walker.readFileSafe(f.path) as Promise<string>,
				}));

			const frameworkConfigContents = await Promise.all(
				frameworkConfigFiles.map((f) => f.content),
			);
			const configHash = await hashFrameworkConfigFiles(
				frameworkConfigFiles.map((f, i) => ({
					path: f.path,
					content: frameworkConfigContents[i] || "",
				})),
			);

			const cacheKey = this.cache.generateKey(rootPath, revision, configHash);
			const cachedProfile = await this.cache.get(cacheKey);

			if (cachedProfile) {
				return {
					success: true,
					profile: cachedProfile,
					durationMs: Date.now() - startTime,
				};
			}

			// Detect frameworks
			const { frameworks, warnings: frameworkWarnings } =
				await this.detectFrameworks(fs);
			const primaryFramework = frameworks.find((f) => f.primary);

			// Detect languages
			const languages = detectLanguages(scanResult.files);

			// Detect package managers
			const packageManagerFiles = scanResult.files
				.filter((f) => {
					const name = basename(f.path);
					return [
						"package.json",
						"yarn.lock",
						"pnpm-lock.yaml",
						"bun.lockb",
						"requirements.txt",
						"Pipfile",
						"poetry.lock",
						"composer.json",
					].includes(name);
				})
				.map((f) => f.relativePath);

			const primaryPackageManager = detectPackageManager(packageManagerFiles);

			// Discover rules
			const { rules } = await this.discoverRules(rootPath, fs);

			// Discover commands
			const { commands } = await this.discoverCommands(rootPath, fs);

			// Extract permitted/prohibited commands from rules (for future use)
			extractCommandsFromRules(rules);

			// Detect test capabilities
			const testCapabilities = await detectTestCapabilities(
				fs,
				primaryFramework?.category || "unknown",
			);

			// Detect applications (monorepo support)
			const applications: ProjectProfile["applications"] = [];
			if (request.config?.detectMonorepo !== false) {
				// Look for sub-applications
				const subdirs = scanResult.files
					.filter((f) => {
						const parts = f.relativePath.split("/");
						return (
							parts.length >= 2 &&
							parts[parts.length - 1] === "package.json" &&
							!f.relativePath.startsWith("node_modules")
						);
					})
					.map((f) => dirname(f.relativePath));

				for (const subdir of subdirs) {
					const packageJson = await this.parseJsonFile<Record<string, unknown>>(
						join(rootPath, subdir, "package.json"),
					);
					if (packageJson && packageJson.name) {
						applications.push({
							id: String(packageJson.name),
							root: join(rootPath, subdir),
							framework: "unknown",
							packageManager: primaryPackageManager || undefined,
							testCommands: [],
							buildCommands: [],
							entryPoints: [],
							relativePath: subdir,
						});
					}
				}
			}

			// Build sensitive and generated paths
			const sensitivePaths = scanResult.files
				.filter((f) => f.sensitive)
				.map((f) => f.relativePath);

			const generatedPaths = scanResult.files
				.filter((f) => f.generated)
				.map((f) => f.relativePath);

			// Calculate confidence
			const avgFrameworkConfidence =
				frameworks.length > 0
					? frameworks.reduce((sum, f) => sum + f.confidence, 0) /
						frameworks.length
					: 0;

			// Build warnings
			const warnings: ProjectProfile["warnings"] = [...frameworkWarnings];

			if (languages.length === 0) {
				warnings.push({
					code: "UNKNOWN_LANGUAGE",
					message: "No programming languages detected",
				});
			}

			if (testCapabilities.length === 0) {
				warnings.push({
					code: "NO_TEST_CONFIG",
					message: "No test configuration detected",
				});
			}

			if (packageManagerFiles.length > 1) {
				warnings.push({
					code: "MULTIPLE_PACKAGE_MANAGERS",
					message: `Multiple package managers detected: ${packageManagerFiles.join(", ")}`,
					affected: packageManagerFiles,
				});
			}

			// Build profile
			const profile: ProjectProfile = {
				repositoryRoot: rootPath,
				repositoryName: basename(rootPath),
				revision,
				frameworks,
				languages,
				packageManagers: primaryPackageManager
					? [
							{
								type: primaryPackageManager,
								configPath:
									packageManagerFiles.find((f) =>
										f.includes(primaryPackageManager),
									) || "",
								primary: true,
							},
						]
					: [],
				applications,
				commands,
				rules,
				sensitivePaths,
				generatedPaths,
				testCapabilities,
				confidence: avgFrameworkConfidence,
				warnings,
				analyzedAt: new Date().toISOString(),
			};

			// Cache result
			await this.cache.set(cacheKey, profile, {
				ruleHash,
				manifestHash,
				configHash,
			});

			return {
				success: true,
				profile,
				durationMs: Date.now() - startTime,
			};
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			let errorCode: AnalysisErrorCode = "UNKNOWN_ERROR";

			if (error.includes("ENOENT")) {
				errorCode = "REPOSITORY_NOT_FOUND";
			} else if (error.includes("not a directory")) {
				errorCode = "NOT_A_DIRECTORY";
			} else if (error.includes("escape")) {
				errorCode = "SYMLINK_ESCAPE";
			}

			return {
				success: false,
				error,
				errorCode,
				durationMs: Date.now() - startTime,
			};
		}
	}
}

/**
 * Create a project analyzer with default configuration.
 */
export function createProjectAnalyzer(options?: {
	cache?: AnalysisCache;
	plugins?: FrameworkAnalyzerPlugin[];
}): ProjectAnalyzer {
	return new ProjectAnalyzer(options);
}

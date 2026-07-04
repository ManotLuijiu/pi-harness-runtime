/**
 * Project Detector — RFC-0014
 *
 * Auto-detect project framework and choose suitable dummy data,
 * seed strategy, and E2E approach.
 */

import type {
	ProjectType,
	ProjectDetection,
	SeedStrategy,
	E2EStrategy,
} from "../../packages/types/src/runtime-types.ts";
import { readJson } from "../../cli.ts";
// @ts-expect-error - Bun has built-in Node.js types
import { join } from "node:path";

export interface DetectionSignal {
	pattern: string;
	weight: number;
	matched: boolean;
}

export interface ProjectDetectorOptions {
	rootDir?: string;
	maxDepth?: number;
}

export class ProjectDetector {
	private readonly signals: Map<ProjectType, DetectionSignal[]> = new Map([
		[
			"frappe_erpnext",
			[
				{ pattern: "frappe-bench/sites", weight: 0.3, matched: false },
				{ pattern: "frappe-bench/apps", weight: 0.2, matched: false },
				{ pattern: "hooks.py", weight: 0.2, matched: false },
				{ pattern: "doctype/", weight: 0.2, matched: false },
				{ pattern: "bench", weight: 0.1, matched: false },
			],
		],
		[
			"frappe_spa",
			[
				{
					pattern: "frappe-bench/apps/*/frontend",
					weight: 0.3,
					matched: false,
				},
				{ pattern: "vite.config.", weight: 0.2, matched: false },
				{ pattern: ".reactrc", weight: 0.15, matched: false },
				{ pattern: "package.json", weight: 0.15, matched: false },
				{ pattern: "tsx", weight: 0.2, matched: false },
			],
		],
		[
			"nextjs",
			[
				{ pattern: "next.config.", weight: 0.3, matched: false },
				{ pattern: "package.json", weight: 0.15, matched: false },
				{ pattern: "pages/", weight: 0.2, matched: false },
				{ pattern: "app/", weight: 0.25, matched: false },
				{ pattern: '"next"', weight: 0.1, matched: false },
			],
		],
		[
			"react_vite",
			[
				{ pattern: "vite.config.", weight: 0.3, matched: false },
				{ pattern: "package.json", weight: 0.15, matched: false },
				{ pattern: "src/main.tsx", weight: 0.25, matched: false },
				{ pattern: "index.html", weight: 0.15, matched: false },
				{ pattern: '"vite"', weight: 0.15, matched: false },
			],
		],
		[
			"django",
			[
				{ pattern: "manage.py", weight: 0.4, matched: false },
				{ pattern: "settings.py", weight: 0.25, matched: false },
				{ pattern: "wsgi.py", weight: 0.15, matched: false },
				{ pattern: "migrations/", weight: 0.2, matched: false },
			],
		],
		[
			"laravel",
			[
				{ pattern: "artisan", weight: 0.4, matched: false },
				{ pattern: "database/seeders", weight: 0.25, matched: false },
				{ pattern: "composer.json", weight: 0.15, matched: false },
				{ pattern: "routes/", weight: 0.2, matched: false },
			],
		],
	]);

	/**
	 * Detect project type from a directory
	 */
	async detect(rootDir: string): Promise<ProjectDetection> {
		const projectFiles = await this.scanDirectory(rootDir);

		// Score each project type
		const scores: Record<ProjectType, number> = {
			frappe_erpnext: 0,
			frappe_spa: 0,
			nextjs: 0,
			react_vite: 0,
			django: 0,
			laravel: 0,
			generic_web: 0,
			unknown: 0,
		};

		const signals: string[] = [];

		for (const [projectType, signalList] of this.signals) {
			for (const signal of signalList) {
				signal.matched = false;
				for (const file of projectFiles) {
					if (file.includes(signal.pattern)) {
						signal.matched = true;
						scores[projectType] += signal.weight;
						if (!signals.includes(signal.pattern)) {
							signals.push(signal.pattern);
						}
						break;
					}
				}
			}
		}

		// Find the project type with highest score
		let bestType: ProjectType = "unknown";
		let bestScore = 0;

		for (const [projectType, score] of Object.entries(scores)) {
			if (score > bestScore) {
				bestScore = score;
				bestType = projectType as ProjectType;
			}
		}

		// Check for generic web
		if (projectFiles.some((f) => f === "package.json")) {
			if (bestType === "unknown") {
				bestType = "generic_web";
			}
		}

		// Determine confidence based on score
		const confidence = Math.min(1, bestScore);

		return {
			projectType: bestType,
			confidence,
			signals,
			recommendedSeedStrategy: this.getSeedStrategy(bestType),
			recommendedE2EStrategy: this.getE2EStrategy(bestType),
			...this.getAdditionalInfo(bestType, projectFiles),
		};
	}

	/**
	 * Scan directory for relevant files
	 */
	private async scanDirectory(rootDir: string): Promise<string[]> {
		// This is a simplified implementation.
		// In practice, you'd use recursive directory scanning.
		const files: string[] = [];

		try {
			// Check for common files
			const checks = [
				"frappe-bench",
				"frappe-bench/sites",
				"frappe-bench/apps",
				"hooks.py",
				"doctype",
				"bench",
				"vite.config.ts",
				"vite.config.js",
				"next.config.js",
				"next.config.ts",
				"package.json",
				"pages",
				"app",
				"src/main.tsx",
				"index.html",
				"manage.py",
				"settings.py",
				"artisan",
				"database/seeders",
			];

			// @ts-expect-error - Bun has built-in file system access
			const { existsSync } = await import("node:fs");
			// @ts-expect-error - Bun has built-in file system access
			const { readdirSync } = await import("node:fs");

			for (const check of checks) {
				const fullPath = join(rootDir, check);
				if (existsSync(fullPath)) {
					files.push(check);
				}
			}

			// Scan root directory for common files
			try {
				const rootFiles = readdirSync(rootDir);
				for (const file of rootFiles) {
					if (file.includes("package.json")) files.push(file);
					if (file.includes("vite.config")) files.push(file);
					if (file.includes("next.config")) files.push(file);
				}
			} catch {
				// Ignore errors
			}
		} catch {
			// Return empty on error
		}

		return files;
	}

	/**
	 * Get recommended seed strategy
	 */
	private getSeedStrategy(projectType: ProjectType): SeedStrategy {
		const strategies: Record<ProjectType, SeedStrategy> = {
			frappe_erpnext: "frappe_doc_insert",
			frappe_spa: "frappe_site_seed",
			nextjs: "nextjs_factory",
			react_vite: "react_factory",
			django: "django_fixture",
			laravel: "laravel_factory",
			generic_web: "generic_sql",
			unknown: "generic_sql",
		};
		return strategies[projectType];
	}

	/**
	 * Get recommended E2E strategy
	 */
	private getE2EStrategy(projectType: ProjectType): E2EStrategy {
		const strategies: Record<ProjectType, E2EStrategy> = {
			frappe_erpnext: "bench_site_browser_flow",
			frappe_spa: "bench_site_browser_flow",
			nextjs: "next_dev_server_flow",
			react_vite: "vite_dev_server_flow",
			django: "django_test_client_flow",
			laravel: "laravel_dusk_flow",
			generic_web: "generic_playwright_flow",
			unknown: "generic_playwright_flow",
		};
		return strategies[projectType];
	}

	/**
	 * Get additional project info
	 */
	private getAdditionalInfo(
		projectType: ProjectType,
		files: string[],
	): { framework?: string; version?: string } {
		const info: { framework?: string; version?: string } = {};

		// Try to extract version from package.json (if rootDir is available)
		if (files.includes("package.json")) {
			try {
				const pkgPath = join(".", "package.json");
				const pkg = readJson(pkgPath) as {
					version?: string;
					dependencies?: Record<string, string>;
				} | null;
				if (pkg?.version) {
					info.version = pkg.version;
				}
			} catch {
				// Ignore
			}
		}

		// Set framework name
		const frameworks: Partial<Record<ProjectType, string>> = {
			frappe_erpnext: "Frappe/ERPNext",
			frappe_spa: "Frappe SPA",
			nextjs: "Next.js",
			react_vite: "React + Vite",
			django: "Django",
			laravel: "Laravel",
			generic_web: "Generic Web",
		};
		info.framework = frameworks[projectType];

		return info;
	}

	/**
	 * Generate detection report
	 */
	generateReport(detection: ProjectDetection): string {
		const lines = [
			"Project Detection Report",
			"=".repeat(40),
			"",
			`Type: ${detection.projectType}`,
			`Framework: ${detection.framework ?? "Unknown"}`,
			`Confidence: ${(detection.confidence * 100).toFixed(1)}%`,
			"",
			"Signals:",
		];

		for (const signal of detection.signals) {
			lines.push(`  - ${signal}`);
		}

		lines.push("");
		lines.push("Recommendations:");
		lines.push(`  Seed Strategy: ${detection.recommendedSeedStrategy}`);
		lines.push(`  E2E Strategy: ${detection.recommendedE2EStrategy}`);

		if (detection.version) {
			lines.push(`  Version: ${detection.version}`);
		}

		return lines.join("\n");
	}
}

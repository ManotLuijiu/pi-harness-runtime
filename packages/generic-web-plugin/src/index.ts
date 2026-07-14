/**
 * Generic Web Plugin — Main Entry (RFC-0066)
 */

import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
import { analyzeWeb } from "./analyzer.js";

export type {
	GenericWebAnalysis,
	WebFrameworkType,
	PageRoute,
	ApiEndpoint,
} from "./types.js";

/**
 * Analyze a generic web project (RFC-0066)
 */
export async function analyzeWebWorkspace(
	workspaceRoot: string,
): Promise<import("./types.js").GenericWebAnalysis | null> {
	return analyzeWeb(workspaceRoot);
}

/**
 * Generic Web Framework Plugin (RFC-0066)
 *
 * Detects and deeply analyzes generic web frameworks:
 * - Framework type detection (Next.js, Nuxt, Remix, Astro, Express, Fastify, etc.)
 * - Route file discovery (pages, app/, components)
 * - API endpoint scanning (routes/, pages/api/, controllers)
 * - SSR/static detection
 */
export function createGenericWebPlugin(): FrameworkExtension {
	return {
		capability: "framework",
		name: "Generic Web Framework Plugin",
		detector: {
			detect: async (workspaceRoot: unknown): Promise<unknown> => {
				const root = workspaceRoot as string;
				const { existsSync } = await import("node:fs");
				return (
					existsSync(`${root}/package.json`) ||
					existsSync(`${root}/pages`) ||
					existsSync(`${root}/app`) ||
					existsSync(`${root}/src`) ||
					existsSync(`${root}/routes`) ||
					existsSync(`${root}/manage.py`) ||
					existsSync(`${root}/composer.json`)
				);
			},
			signals: [
				{ type: "package", pattern: "package.json", weight: 0.5 },
				{ type: "directory", pattern: "src", weight: 0.4 },
				{ type: "directory", pattern: "pages", weight: 0.4 },
				{ type: "directory", pattern: "app", weight: 0.3 },
				{ type: "file", pattern: "routes", weight: 0.3 },
			],
		},
		config: {},
	};
}

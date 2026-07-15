/**
 * Next.js Plugin — Main Entry (RFC-0062)
 */

import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
import { analyzeNextJs } from "./analyzer.js";

export type { NextJsAnalysis, AppRoute, ConfigFile } from "./types.js";

export async function analyzeNextJsWorkspace(
	root: string,
): Promise<import("./types.js").NextJsAnalysis | null> {
	return analyzeNextJs(root);
}

export function createNextJsPlugin(): FrameworkExtension {
	return {
		capability: "framework",
		name: "Next.js Framework Plugin",
		detector: {
			detect: async (root: unknown): Promise<unknown> => {
				const r = root as string;
				const { existsSync } = await import("node:fs");
				return (
					existsSync(`${r}/next.config.js`) ||
					existsSync(`${r}/next.config.mjs`) ||
					existsSync(`${r}/next.config.ts`) ||
					existsSync(`${r}/app`) ||
					existsSync(`${r}/pages`)
				);
			},
			signals: [
				{ type: "file", pattern: "next.config", weight: 0.6 },
				{ type: "directory", pattern: "app", weight: 0.4 },
				{ type: "directory", pattern: "pages", weight: 0.3 },
				{ type: "package", pattern: "next", weight: 0.5 },
			],
		},
		config: {},
	};
}

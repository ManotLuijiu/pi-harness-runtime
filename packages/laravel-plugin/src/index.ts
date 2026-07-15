/**
 * Laravel Plugin — Main Entry (RFC-0065)
 */

import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
import { analyzeLaravel } from "./analyzer.js";

export type { LaravelAnalysis } from "./types.js";

export async function analyzeLaravelWorkspace(
	root: string,
): Promise<import("./types.js").LaravelAnalysis | null> {
	return analyzeLaravel(root);
}

export function createLaravelPlugin(): FrameworkExtension {
	return {
		capability: "framework",
		name: "Laravel Framework Plugin",
		detector: {
			detect: async (root: unknown): Promise<unknown> => {
				const r = root as string;
				const { existsSync } = await import("node:fs");
				return (
					existsSync(`${r}/artisan`) ||
					(existsSync(`${r}/composer.json`) &&
						(existsSync(`${r}/app/Http/Controllers`) ||
							existsSync(`${r}/bootstrap/app.php`)))
				);
			},
			signals: [
				{ type: "file", pattern: "artisan", weight: 0.7 },
				{ type: "file", pattern: "composer.json", weight: 0.3 },
				{ type: "directory", pattern: "app/Http/Controllers", weight: 0.5 },
				{ type: "directory", pattern: "bootstrap/app.php", weight: 0.4 },
			],
		},
		config: {},
	};
}

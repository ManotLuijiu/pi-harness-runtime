/**
 * Django Plugin — Main Entry (RFC-0064)
 */

import type { FrameworkExtension } from "../../framework-plugin-sdk/src/types.js";
import { analyzeDjango } from "./analyzer.js";

export type { DjangoAnalysis, DjangoApp, ConfigFile } from "./types.js";

export async function analyzeDjangoWorkspace(
	root: string,
): Promise<import("./types.js").DjangoAnalysis | null> {
	return analyzeDjango(root);
}

export function createDjangoPlugin(): FrameworkExtension {
	return {
		capability: "framework",
		name: "Django Framework Plugin",
		detector: {
			detect: async (root: unknown): Promise<unknown> => {
				const r = root as string;
				const { existsSync } = await import("node:fs");
				return (
					existsSync(`${r}/manage.py`) ||
					(existsSync(`${r}/settings.py`) &&
						existsSync(`${r}/requirements.txt`))
				);
			},
			signals: [
				{ type: "file", pattern: "manage.py", weight: 0.6 },
				{ type: "file", pattern: "settings.py", weight: 0.4 },
				{ type: "package", pattern: "django", weight: 0.5 },
				{ type: "directory", pattern: "migrations", weight: 0.3 },
			],
		},
		config: {},
	};
}

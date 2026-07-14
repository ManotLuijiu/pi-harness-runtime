/**
 * Next.js Plugin — Main Entry (RFC-0062)
 */
import { analyzeNextJs } from "./analyzer.js";
export async function analyzeNextJsWorkspace(root) {
    return analyzeNextJs(root);
}
export function createNextJsPlugin() {
    return {
        capability: "framework",
        name: "Next.js Framework Plugin",
        detector: {
            detect: async (root) => {
                const r = root;
                const { existsSync } = await import("node:fs");
                return (existsSync(`${r}/next.config.js`) ||
                    existsSync(`${r}/next.config.mjs`) ||
                    existsSync(`${r}/next.config.ts`) ||
                    existsSync(`${r}/app`) ||
                    existsSync(`${r}/pages`));
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
//# sourceMappingURL=index.js.map
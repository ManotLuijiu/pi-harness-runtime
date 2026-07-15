/**
 * React/Vite Plugin — Main Entry (RFC-0063)
 */
import { analyzeReactVite } from "./analyzer.js";
export async function analyzeReactViteWorkspace(root) {
    return analyzeReactVite(root);
}
export function createReactVitePlugin() {
    return {
        capability: "framework",
        name: "React/Vite Framework Plugin",
        detector: {
            detect: async (root) => {
                const r = root;
                const { existsSync } = await import("node:fs");
                return (existsSync(`${r}/vite.config.ts`) ||
                    existsSync(`${r}/vite.config.js`) ||
                    (existsSync(`${r}/package.json`) && existsSync(`${r}/src`)));
            },
            signals: [
                { type: "file", pattern: "vite.config", weight: 0.6 },
                { type: "package", pattern: "vite", weight: 0.5 },
                { type: "package", pattern: "react", weight: 0.4 },
                { type: "directory", pattern: "src", weight: 0.3 },
            ],
        },
        config: {},
    };
}
//# sourceMappingURL=index.js.map
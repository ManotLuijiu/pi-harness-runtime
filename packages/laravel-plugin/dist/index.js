/**
 * Laravel Plugin — Main Entry (RFC-0065)
 */
import { analyzeLaravel } from "./analyzer.js";
export async function analyzeLaravelWorkspace(root) {
    return analyzeLaravel(root);
}
export function createLaravelPlugin() {
    return {
        capability: "framework",
        name: "Laravel Framework Plugin",
        detector: {
            detect: async (root) => {
                const r = root;
                const { existsSync } = await import("node:fs");
                return (existsSync(`${r}/artisan`) ||
                    (existsSync(`${r}/composer.json`) &&
                        (existsSync(`${r}/app/Http/Controllers`) ||
                            existsSync(`${r}/bootstrap/app.php`))));
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
//# sourceMappingURL=index.js.map
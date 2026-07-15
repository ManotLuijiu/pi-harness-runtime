/**
 * Django Plugin — Main Entry (RFC-0064)
 */
import { analyzeDjango } from "./analyzer.js";
export async function analyzeDjangoWorkspace(root) {
    return analyzeDjango(root);
}
export function createDjangoPlugin() {
    return {
        capability: "framework",
        name: "Django Framework Plugin",
        detector: {
            detect: async (root) => {
                const r = root;
                const { existsSync } = await import("node:fs");
                return (existsSync(`${r}/manage.py`) ||
                    (existsSync(`${r}/settings.py`) &&
                        existsSync(`${r}/requirements.txt`)));
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
//# sourceMappingURL=index.js.map
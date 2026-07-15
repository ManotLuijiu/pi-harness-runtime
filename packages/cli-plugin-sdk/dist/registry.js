/**
 * CLI Plugin SDK — NPM Registry Client (RFC-0067)
 */
import { execa } from "execa";
/**
 * Query npm registry for plugins matching query
 */
export async function searchPlugins(query, registry) {
    try {
        const args = ["search", query, "--json", "--prefer-online"];
        if (registry)
            args.push("--registry", registry);
        const { stdout } = await execa("npm", args);
        const results = JSON.parse(stdout);
        return results.slice(0, 20).map((r) => ({
            name: r.name,
            version: r.version,
            description: r.description || "",
            downloads: r.downloads ?? 0,
        }));
    }
    catch {
        return [];
    }
}
/**
 * Get package info from npm
 */
export async function getPackageInfo(name, registry) {
    try {
        const args = ["view", name, "version", "description", "--json"];
        if (registry)
            args.push("--registry", registry);
        const { stdout } = await execa("npm", args);
        const info = JSON.parse(stdout);
        return {
            version: info.version ?? "0.0.0",
            description: info.description ?? "",
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=registry.js.map
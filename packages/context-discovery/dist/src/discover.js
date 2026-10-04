import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"]);
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function scanDir(dir, limit) {
    const results = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (results.length >= limit)
                break;
            const full = join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                results.push(...scanDir(full, limit - results.length));
            }
            else if (entry.isFile() && CODE_EXTS.has(extname(entry.name))) {
                try {
                    const content = readFileSync(full, "utf8").slice(0, 8000);
                    results.push({
                        id: full,
                        kind: "source",
                        path: full,
                        title: entry.name,
                        content,
                        tokens: estimateTokens(content),
                        trust: "high",
                        tags: [extname(entry.name).replace(".", "")],
                    });
                }
                catch { /* skip unreadable */ }
            }
        }
    }
    catch { /* skip inaccessible */ }
    return results;
}
export function discoverContext(root, options = {}) {
    const limit = options.limit ?? 50;
    return scanDir(root, limit);
}
//# sourceMappingURL=discover.js.map
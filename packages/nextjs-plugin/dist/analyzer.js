/**
 * Next.js Analyzer (RFC-0062)
 *
 * Deep analysis of Next.js workspaces via filesystem inspection.
 * Does NOT evaluate code or connect to the network.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// ─── Detection ───────────────────────────────────────────────────────────────
function isNextJsWorkspace(root) {
    return (existsSync(join(root, "next.config.js")) ||
        existsSync(join(root, "next.config.mjs")) ||
        existsSync(join(root, "next.config.ts")) ||
        existsSync(join(root, "app")) ||
        existsSync(join(root, "pages")));
}
// ─── Version Detection ───────────────────────────────────────────────────────
async function detectVersion(root) {
    try {
        const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
        return pkg.dependencies?.next
            ? pkg.dependencies.next.replace(/[\^~>=<]/, "")
            : pkg.devDependencies?.next
                ? pkg.devDependencies.next.replace(/[\^~>=<]/, "")
                : undefined;
    }
    catch {
        return undefined;
    }
}
// ─── Router Detection ───────────────────────────────────────────────────────
async function detectRouters(root) {
    const hasApp = existsSync(join(root, "app"));
    const hasPages = existsSync(join(root, "pages"));
    return { usingAppRouter: hasApp, usingPagesRouter: hasPages };
}
// ─── Config Files ────────────────────────────────────────────────────────────
async function findConfigFiles(root) {
    const configFiles = [
        { name: "next.config.js", path: join(root, "next.config.js") },
        { name: "next.config.mjs", path: join(root, "next.config.mjs") },
        { name: "next.config.ts", path: join(root, "next.config.ts") },
    ];
    const configs = [];
    for (const cfg of configFiles) {
        if (existsSync(cfg.path)) {
            configs.push({ name: cfg.name, path: cfg.path });
        }
    }
    return configs;
}
// ─── App Router Routes ─────────────────────────────────────────────────────
async function walkAppRouter(dir, base = "") {
    const routes = [];
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith("_") || entry.name.startsWith("."))
                continue;
            const rel = base ? `${base}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                // Dynamic segment: [param] or (group)
                const isDynamic = entry.name.startsWith("[") && entry.name.endsWith("]");
                const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
                if (!isGroup) {
                    routes.push({
                        path: rel,
                        method: "GET",
                        isDynamic,
                        file: rel,
                    });
                }
                const sub = await walkAppRouter(join(dir, entry.name), rel);
                routes.push(...sub);
            }
            else if (entry.name === "page.tsx" || entry.name === "page.ts") {
                routes.push({
                    path: rel.replace(/page\.(tsx?|jsx?)$/, ""),
                    method: "GET",
                    isDynamic: base.includes("["),
                    file: rel,
                });
            }
            else if (entry.name === "route.ts" || entry.name === "route.js") {
                // HTTP method detection from siblings
                routes.push({
                    path: rel.replace(/\/route\.(ts|js)$/, ""),
                    method: "ALL",
                    isDynamic: base.includes("["),
                    file: rel,
                });
            }
        }
    }
    catch {
        // ignore
    }
    return routes;
}
// ─── Pages Router API Routes ─────────────────────────────────────────────────
async function walkApiRoutes(dir, base = "") {
    const routes = [];
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith("_") || entry.name.startsWith("."))
                continue;
            const rel = base ? `${base}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                routes.push(...(await walkApiRoutes(join(dir, entry.name), rel)));
            }
            else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
                const normalized = rel.replace(/\.(ts|js)$/, "").replace(/index$/, "");
                if (!routes.includes(normalized)) {
                    routes.push(normalized);
                }
            }
        }
    }
    catch {
        // ignore
    }
    return routes;
}
// ─── Middleware ─────────────────────────────────────────────────────────────
async function findMiddleware(root) {
    const candidates = [
        join(root, "middleware.ts"),
        join(root, "middleware.js"),
        join(root, "middleware.tsx"),
        join(root, "middleware.jsx"),
    ];
    for (const p of candidates) {
        if (existsSync(p))
            return p;
    }
    return undefined;
}
// ─── Environment Variables ─────────────────────────────────────────────────
async function findEnvVars(root) {
    const candidates = [
        join(root, ".env.example"),
        join(root, ".env.local"),
        join(root, ".env.development"),
        join(root, ".env.production"),
    ];
    const vars = [];
    const seen = new Set();
    for (const p of candidates) {
        if (existsSync(p)) {
            try {
                const content = await readFile(p, "utf-8");
                for (const line of content.split("\n")) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
                        const key = trimmed.split("=")[0].trim();
                        if (key && !seen.has(key)) {
                            seen.add(key);
                            vars.push(key);
                        }
                    }
                }
            }
            catch {
                // ignore
            }
        }
    }
    return vars;
}
// ─── Main Analyzer ─────────────────────────────────────────────────────────
/**
 * Analyze a Next.js workspace (RFC-0062)
 */
export async function analyzeNextJs(root) {
    if (!isNextJsWorkspace(root)) {
        return null;
    }
    const [version, routers, configs] = await Promise.all([
        detectVersion(root),
        detectRouters(root),
        findConfigFiles(root),
    ]);
    const appRoutes = [];
    if (routers.usingAppRouter) {
        appRoutes.push(...(await walkAppRouter(join(root, "app"))));
    }
    const apiRoutes = [];
    if (routers.usingPagesRouter) {
        const apiDir = join(root, "pages", "api");
        if (existsSync(apiDir)) {
            apiRoutes.push(...(await walkApiRoutes(apiDir)));
        }
    }
    const [middleware, environmentVars] = await Promise.all([
        findMiddleware(root),
        findEnvVars(root),
    ]);
    return {
        framework: {
            id: "nextjs",
            name: "Next.js",
            category: "fullstack",
            description: "The React Framework for Production",
            tags: ["react", "ssr", "fullstack", "typescript"],
        },
        version,
        ...routers,
        apiRoutes,
        appRoutes,
        middleware,
        environmentVars,
        configs,
    };
}
//# sourceMappingURL=analyzer.js.map
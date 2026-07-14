/**
 * Generic Web Plugin — Analyzer (RFC-0066)
 *
 * Detects and deeply analyzes generic web projects.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
// ─── Detection ────────────────────────────────────────────────────────────────
/**
 * Detect if a directory is a generic web project
 */
export async function detectWeb(root) {
    const hasPackageJson = existsSync(join(root, "package.json"));
    const hasNodeModules = existsSync(join(root, "node_modules"));
    const hasSrc = existsSync(join(root, "src")) ||
        existsSync(join(root, "app")) ||
        existsSync(join(root, "pages")) ||
        existsSync(join(root, "components"));
    return hasPackageJson && (hasNodeModules || hasSrc);
}
// ─── Framework Detection ────────────────────────────────────────────────────
async function detectFramework(root) {
    const pkgJson = await readFile(join(root, "package.json"), "utf-8").catch(() => "{}");
    const pkg = JSON.parse(pkgJson);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};
    if (deps["next"])
        return "next";
    if (deps["@remix-run/react"])
        return "remix";
    if (deps["astro"])
        return "astro";
    if (deps["nuxt"])
        return "nuxt";
    if (deps["svelte"])
        return "svelte";
    if (deps["vite"] && deps["react"])
        return "react-vite";
    if (deps["vite"] && deps["vue"])
        return "vue-vite";
    if (deps["webpack"])
        return "webpack";
    if (deps["express"])
        return "express";
    if (deps["fastify"])
        return "fastify";
    if (deps["koa"])
        return "koa";
    if (deps["hono"])
        return "hono";
    if (deps["flask"])
        return "flask";
    if (deps["django"])
        return "django";
    if (deps["rails"] || deps["@rails/ujs"])
        return "rails";
    if (deps["laravel-mix"] || deps["laravel"])
        return "laravel";
    if (scripts["nuxt"] || scripts["nuxt:build"])
        return "nuxt";
    if (scripts["astro"] || scripts["astro:build"])
        return "astro";
    return "static";
}
// ─── Route Scanning ─────────────────────────────────────────────────────────
async function findRouteFiles(root, framework) {
    const routes = [];
    const patterns = getRoutePatterns(framework);
    for (const { dir, exts } of patterns) {
        const fullDir = join(root, dir);
        if (!existsSync(fullDir))
            continue;
        await scanDir(fullDir, fullDir, exts, (filePath, relPath) => {
            const path = relPath
                .replace(/\\/g, "/")
                .replace(new RegExp(`\\${exts[0]}$`), "")
                .replace(/\/index$/, "")
                .replace(/^\//, "");
            const route = {
                path: path || "/",
                file: filePath,
                component: guessComponentName(framework, path),
            };
            routes.push(route);
        });
    }
    return deduplicateRoutes(routes);
}
function getRoutePatterns(framework) {
    switch (framework) {
        case "next":
            return [
                { dir: "pages", exts: [".tsx", ".jsx", ".ts", ".js"] },
                { dir: "app", exts: [".tsx", ".jsx"] },
            ];
        case "nuxt":
        case "remix":
        case "astro":
            return [{ dir: "app", exts: [".tsx", ".jsx", ".svelte", ".vue"] }];
        case "react-vite":
        case "vue-vite":
        case "svelte":
        case "static":
        default:
            return [
                { dir: "src", exts: [".tsx", ".jsx", ".svelte", ".vue"] },
                { dir: "components", exts: [".tsx", ".jsx", ".svelte", ".vue"] },
                { dir: "pages", exts: [".tsx", ".jsx"] },
            ];
        case "express":
        case "fastify":
        case "koa":
        case "hono":
            return [{ dir: "routes", exts: [".ts", ".js"] }];
        case "django":
            return [
                { dir: "templates", exts: [".html"] },
                { dir: "views", exts: [".py"] },
            ];
        case "flask":
            return [
                { dir: "templates", exts: [".html"] },
                { dir: "routes", exts: [".py"] },
            ];
        case "rails":
            return [
                { dir: "app/views", exts: [".html.erb", ".html.slim", ".html.haml"] },
                { dir: "app/controllers", exts: [".rb"] },
            ];
        case "laravel":
            return [
                { dir: "resources/views", exts: [".blade.php", ".php"] },
                { dir: "routes", exts: [".php"] },
            ];
    }
}
async function scanDir(dir, base, exts, emit) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name.startsWith("_"))
            continue;
        const fullPath = join(dir, entry.name);
        const relPath = join(base, entry.name)
            .slice(join(base, "").length)
            .replace(/^[/\\]/, "");
        if (entry.isDirectory()) {
            await scanDir(fullPath, base, exts, emit);
        }
        else if (exts.includes(extname(entry.name))) {
            emit(fullPath, relPath);
        }
    }
}
function guessComponentName(framework, path) {
    const name = path.split("/").pop() || "index";
    switch (framework) {
        case "react-vite":
            return `${name.charAt(0).toUpperCase()}${name.slice(1)}.tsx`;
        case "vue-vite":
            return `${name.charAt(0).toUpperCase()}${name.slice(1)}.vue`;
        case "svelte":
            return `${name.charAt(0).toUpperCase()}${name.slice(1)}.svelte`;
        case "next":
        case "nuxt":
        case "remix":
            return path.replace(/\//g, "-").replace(/^-/, "") || "home";
        default:
            return name;
    }
}
function deduplicateRoutes(routes) {
    const seen = new Set();
    const result = [];
    for (const route of routes) {
        if (!seen.has(route.path)) {
            seen.add(route.path);
            result.push(route);
        }
    }
    return result;
}
// ─── API Endpoint Detection ──────────────────────────────────────────────────
async function findApiEndpoints(root, framework) {
    if (![
        "express",
        "fastify",
        "koa",
        "hono",
        "flask",
        "django",
        "rails",
        "laravel",
        "next",
    ].includes(framework)) {
        return [];
    }
    const endpoints = [];
    const patterns = getApiPatterns(framework);
    for (const { dir, exts } of patterns) {
        const fullDir = join(root, dir);
        if (!existsSync(fullDir))
            continue;
        await scanDir(fullDir, fullDir, exts, (filePath, relPath) => {
            const methods = extractHttpMethods(filePath);
            const routePath = relPath
                .replace(/\\/g, "/")
                .replace(new RegExp(`\\${exts[0]}$`), "")
                .replace(/\/index$/, "")
                .replace(/^api\//, "")
                .replace(/^routes\//, "");
            for (const method of methods) {
                endpoints.push({
                    method,
                    path: `/${routePath}`,
                    file: filePath,
                });
            }
        });
    }
    return endpoints;
}
function getApiPatterns(framework) {
    switch (framework) {
        case "express":
        case "fastify":
        case "koa":
        case "hono":
            return [
                { dir: "routes", exts: [".ts", ".js"] },
                { dir: "src/routes", exts: [".ts", ".js"] },
            ];
        case "next":
            return [
                { dir: "pages/api", exts: [".ts", ".js"] },
                { dir: "app/api", exts: [".ts", ".tsx"] },
            ];
        case "flask":
            return [
                { dir: "routes", exts: [".py"] },
                { dir: "app", exts: [".py"] },
            ];
        case "django":
            return [
                { dir: "views", exts: [".py"] },
                { dir: "api", exts: [".py"] },
            ];
        case "rails":
            return [
                { dir: "config/routes.rb", exts: [".rb"] },
                { dir: "app/controllers", exts: [".rb"] },
            ];
        case "laravel":
            return [
                { dir: "routes", exts: [".php"] },
                { dir: "app/Http/Controllers", exts: [".php"] },
            ];
        default:
            return [];
    }
}
function extractHttpMethods(filePath) {
    try {
        const content = require("fs").readFileSync(filePath, "utf-8");
        const methods = new Set();
        if (/\bget\b/i.test(content))
            methods.add("GET");
        if (/\bpost\b/i.test(content))
            methods.add("POST");
        if (/\bput\b/i.test(content))
            methods.add("PUT");
        if (/\bpatch\b/i.test(content))
            methods.add("PATCH");
        if (/\bdelete\b/i.test(content))
            methods.add("DELETE");
        if (/\boptions\b/i.test(content))
            methods.add("OPTIONS");
        return methods.size > 0 ? Array.from(methods) : ["GET"];
    }
    catch {
        return ["GET"];
    }
}
// ─── Analysis ────────────────────────────────────────────────────────────────
/**
 * Deep analysis of a generic web project
 */
export async function analyzeWeb(root) {
    const detected = await detectWeb(root);
    if (!detected)
        return null;
    const framework = await detectFramework(root);
    const [routes, endpoints] = await Promise.all([
        findRouteFiles(root, framework),
        findApiEndpoints(root, framework),
    ]);
    return {
        framework,
        routes,
        endpoints,
        ssr: framework !== "static",
    };
}
//# sourceMappingURL=analyzer.js.map
/**
 * Laravel Analyzer (RFC-0065)
 *
 * Deep analysis of Laravel workspaces via filesystem inspection.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// ─── Detection ───────────────────────────────────────────────────────────────
function isLaravelWorkspace(root) {
    if (existsSync(join(root, "artisan")))
        return true;
    if (existsSync(join(root, "bootstrap", "app.php")))
        return true;
    if (existsSync(join(root, "composer.json"))) {
        // Defer to async version; use basic file presence check as proxy
        return (existsSync(join(root, "app", "Http", "Controllers")) ||
            existsSync(join(root, "app", "Models")) ||
            existsSync(join(root, "app", "Console", "Commands")) ||
            existsSync(join(root, "database", "migrations")) ||
            existsSync(join(root, "bootstrap", "app.php")));
    }
    return false;
}
// ─── Version ────────────────────────────────────────────────────────────────
async function detectVersion(root) {
    const composerPath = join(root, "composer.json");
    if (!existsSync(composerPath))
        return undefined;
    try {
        const composer = JSON.parse(await readFile(composerPath, "utf-8"));
        const requires = {
            ...(composer.require ?? {}),
            ...(composer["require-dev"] ?? {}),
        };
        const laravel = requires["laravel/framework"];
        if (laravel) {
            return laravel.replace(/[\^~>=<]/, "");
        }
        // Also check for laravel/installer pattern
        const pkg = composer.name;
        if (pkg && pkg.toLowerCase().includes("laravel")) {
            return composer.version ?? undefined;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
// ─── Packages ────────────────────────────────────────────────────────────────
async function detectPackages(root) {
    const composerPath = join(root, "composer.json");
    if (!existsSync(composerPath))
        return [];
    try {
        const composer = JSON.parse(await readFile(composerPath, "utf-8"));
        const deps = {
            ...(composer.require ?? {}),
            ...(composer["require-dev"] ?? {}),
        };
        return Object.keys(deps);
    }
    catch {
        return [];
    }
}
// ─── Auth Detection ────────────────────────────────────────────────────────
async function detectAuth(root) {
    const packages = await detectPackages(root);
    if (packages.includes("laravel/sanctum"))
        return "sanctum";
    if (packages.includes("laravel/passport"))
        return "passport";
    if (packages.includes("laravel/spark-aurelius"))
        return "spark";
    if (packages.includes("tymon/jwt-auth"))
        return "jwt";
    // Check config files
    for (const authFile of [
        join(root, "config", "auth.php"),
        join(root, "config", "sanctum.php"),
    ]) {
        if (existsSync(authFile)) {
            try {
                const content = await readFile(authFile, "utf-8");
                if (content.includes("Sanctum") || content.includes("sanctum")) {
                    return "sanctum";
                }
            }
            catch {
                /* ignore */
            }
        }
    }
    return undefined;
}
// ─── Controllers ───────────────────────────────────────────────────────────
async function findControllers(root) {
    const controllerDirs = [
        join(root, "app", "Http", "Controllers"),
        join(root, "app", "Controllers"),
    ];
    const controllers = [];
    for (const dir of controllerDirs) {
        if (!existsSync(dir))
            continue;
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith(".") || entry.name === "Controller.php")
                    continue;
                if (entry.name.endsWith("Controller.php") ||
                    entry.name.endsWith("Controller.ts")) {
                    controllers.push(entry.name.replace(/\.(php|ts)$/, ""));
                }
                else if (entry.isDirectory()) {
                    // Nested controller directory
                    const subEntries = await readdir(join(dir, entry.name));
                    for (const sub of subEntries) {
                        if (sub.endsWith("Controller.php") ||
                            sub.endsWith("Controller.ts")) {
                            controllers.push(`${entry.name}/${sub.replace(/\.(php|ts)$/, "")}`);
                        }
                    }
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    return controllers;
}
// ─── Models ────────────────────────────────────────────────────────────────
async function findModels(root) {
    const modelDirs = [join(root, "app", "Models"), join(root, "app", "Models")];
    const models = [];
    for (const dir of modelDirs) {
        if (!existsSync(dir))
            continue;
        try {
            const entries = await readdir(dir);
            for (const entry of entries) {
                if (entry.startsWith(".") || entry === "User.php")
                    continue;
                if (entry.endsWith(".php")) {
                    models.push(entry.replace(/\.php$/, ""));
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    return models;
}
// ─── Blade Views ───────────────────────────────────────────────────────────
async function findViews(root) {
    const viewDirs = [join(root, "resources", "views"), join(root, "views")];
    const views = [];
    for (const dir of viewDirs) {
        if (!existsSync(dir))
            continue;
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith("."))
                    continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    const subEntries = await readdir(fullPath);
                    for (const sub of subEntries) {
                        if (sub.endsWith(".blade.php")) {
                            views.push(`${entry.name}/${sub}`);
                        }
                    }
                }
                else if (entry.name.endsWith(".blade.php")) {
                    views.push(entry.name);
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    return views;
}
// ─── Artisan Commands ──────────────────────────────────────────────────────
async function findCommands(root) {
    const commandDirs = [
        join(root, "app", "Console", "Commands"),
        join(root, "app", "Commands"),
    ];
    const commands = [];
    for (const dir of commandDirs) {
        if (!existsSync(dir))
            continue;
        try {
            const entries = await readdir(dir);
            for (const entry of entries) {
                if (entry.startsWith(".") || !entry.endsWith(".php"))
                    continue;
                commands.push(entry.replace(/\.php$/, ""));
            }
        }
        catch {
            /* ignore */
        }
    }
    return commands;
}
// ─── Migrations Count ─────────────────────────────────────────────────────
async function countMigrations(root) {
    const migrationDirs = [
        join(root, "database", "migrations"),
        join(root, "migrations"),
    ];
    let count = 0;
    for (const dir of migrationDirs) {
        if (!existsSync(dir))
            continue;
        try {
            const entries = await readdir(dir);
            count += entries.filter((e) => !e.startsWith(".") && e.endsWith(".php")).length;
        }
        catch {
            /* ignore */
        }
    }
    return count;
}
// ─── Env Variables ────────────────────────────────────────────────────────
async function findEnvVars(root) {
    const envFiles = [join(root, ".env.example"), join(root, ".env")];
    const vars = [];
    const seen = new Set();
    for (const envPath of envFiles) {
        if (!existsSync(envPath))
            continue;
        try {
            const content = await readFile(envPath, "utf-8");
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
            /* ignore */
        }
    }
    return vars;
}
// ─── Main Analyzer ─────────────────────────────────────────────────────────
export async function analyzeLaravel(root) {
    if (!isLaravelWorkspace(root))
        return null;
    const [version, packages, authType] = await Promise.all([
        detectVersion(root),
        detectPackages(root),
        detectAuth(root),
    ]);
    const [controllers, models, views, commands, migrations, envVars] = await Promise.all([
        findControllers(root),
        findModels(root),
        findViews(root),
        findCommands(root),
        countMigrations(root),
        findEnvVars(root),
    ]);
    return {
        framework: {
            id: "laravel",
            name: "Laravel",
            category: "fullstack",
            description: "The PHP Framework for Web Artisans",
            tags: ["php", "fullstack", "eloquent"],
        },
        version,
        controllers,
        models,
        views,
        commands,
        migrations,
        authType,
        envVars,
        packages,
    };
}
//# sourceMappingURL=analyzer.js.map
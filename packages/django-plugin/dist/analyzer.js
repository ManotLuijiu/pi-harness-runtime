/**
 * Django Analyzer (RFC-0064)
 *
 * Deep analysis of Django workspaces via filesystem inspection.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// ─── Detection ───────────────────────────────────────────────────────────────
function isDjangoWorkspace(root) {
    return (existsSync(join(root, "manage.py")) ||
        (existsSync(join(root, "settings.py")) &&
            existsSync(join(root, "requirements.txt"))) ||
        (existsSync(join(root, "requirements.txt")) &&
            existsSync(join(root, "manage.py"))));
}
// ─── Version ────────────────────────────────────────────────────────────────
async function detectVersion(root) {
    try {
        const content = await readFile(join(root, "requirements.txt"), "utf-8");
        const match = content.match(/Django[=<>~!^]*((\d+)\.\d+(?:\.\d+)?)/i);
        if (match)
            return match[1];
    }
    catch {
        /* ignore */
    }
    // Check setup.py or pyproject.toml
    for (const cfg of ["setup.py", "pyproject.toml"]) {
        const cfgPath = join(root, cfg);
        if (existsSync(cfgPath)) {
            try {
                const content = await readFile(cfgPath, "utf-8");
                const match = content.match(/django[=<>~!^\s]*(\d+\.\d+(?:\.\d+)?)/i);
                if (match)
                    return match[1];
            }
            catch {
                /* ignore */
            }
        }
    }
    return undefined;
}
// ─── Settings Parser ─────────────────────────────────────────────────────────
async function parseSettings(root) {
    const installedApps = [];
    const middleware = [];
    const candidates = [
        join(root, "settings.py"),
        join(root, "core", "settings.py"),
        join(root, "config", "settings.py"),
    ];
    for (const settingsPath of candidates) {
        if (!existsSync(settingsPath))
            continue;
        try {
            const content = await readFile(settingsPath, "utf-8");
            // Parse INSTALLED_APPS = [ ... ]
            const installedMatch = content.match(/INSTALLED_APPS\s*=\s*\[([\s\S]*?)\]/m);
            if (installedMatch) {
                const listContent = installedMatch[1];
                // Match quoted strings and identifiers
                const appMatches = listContent.matchAll(/(?:^|\s|,)\s*['"]?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)['"]?/g);
                for (const m of appMatches) {
                    const app = m[1].trim();
                    if (app && !app.startsWith("#")) {
                        installedApps.push(app);
                    }
                }
            }
            // Parse MIDDLEWARE = [ ... ]
            const middlewareMatch = content.match(/MIDDLEWARE\s*=\s*\[([\s\S]*?)\]/m);
            if (middlewareMatch) {
                const listContent = middlewareMatch[1];
                const mwMatches = listContent.matchAll(/(?:^|\s|,)\s*['"]?([a-zA-Z_][a-zA-Z0-9_.]*)['"]?/g);
                for (const m of mwMatches) {
                    const mw = m[1].trim();
                    if (mw && !mw.startsWith("#")) {
                        middleware.push(mw);
                    }
                }
            }
            if (installedApps.length > 0)
                break;
        }
        catch {
            // ignore
        }
    }
    return { installedApps, middleware };
}
// ─── Django App Scanner ─────────────────────────────────────────────────────
async function scanDjangoApps(root) {
    const apps = [];
    // Django project apps can be:
    // 1. Top-level directories with models.py
    // 2. Apps in an "apps/" directory
    const searchDirs = [root, join(root, "apps")];
    const seen = new Set();
    for (const searchDir of searchDirs) {
        if (!existsSync(searchDir))
            continue;
        let entries = [];
        try {
            entries = await readdir(searchDir);
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.startsWith(".") || entry.startsWith("_"))
                continue;
            const appPath = join(searchDir, entry);
            let isDir = false;
            try {
                isDir = (await import("node:fs/promises").then((m) => m.stat(appPath))).isDirectory();
            }
            catch {
                continue;
            }
            if (!isDir)
                continue;
            if (seen.has(entry))
                continue;
            seen.add(entry);
            const modelsPath = join(appPath, "models.py");
            const adminPath = join(appPath, "admin.py");
            const migrationsDir = join(appPath, "migrations");
            let modelCount = 0;
            if (existsSync(modelsPath)) {
                try {
                    const modelsContent = await readFile(modelsPath, "utf-8");
                    // Count class definitions that inherit from models.Model
                    const match1 = modelsContent.match(/^class\s+\w+\s*\([^)]*models?\.[Mm]odel[^)]*\)/gm);
                    modelCount = (match1 ?? []).length;
                    // Also count class definitions (conservative)
                    const match2 = modelsContent.match(/class\s+\w+\s*\(/g);
                    modelCount = Math.max(modelCount, (match2 ?? []).length);
                }
                catch {
                    // ignore
                }
            }
            apps.push({
                name: entry,
                path: appPath,
                modelCount,
                hasAdmin: existsSync(adminPath),
                hasMigrations: existsSync(migrationsDir),
            });
        }
    }
    return apps;
}
// ─── Management Commands ────────────────────────────────────────────────────
async function findManagementCommands(root) {
    const commands = [];
    // Simple recursive scan for management/commands directories
    const searchDirs = [];
    try {
        const entries = await readdir(root);
        for (const entry of entries) {
            if (entry.startsWith("."))
                continue;
            const managementDir = join(root, entry, "management", "commands");
            if (existsSync(managementDir)) {
                searchDirs.push(managementDir);
            }
            const appsMgmt = join(root, "apps", entry, "management", "commands");
            if (existsSync(appsMgmt)) {
                searchDirs.push(appsMgmt);
            }
        }
    }
    catch {
        // ignore
    }
    for (const cmdDir of searchDirs) {
        try {
            const cmdEntries = await readdir(cmdDir);
            for (const cmd of cmdEntries) {
                if (cmd.startsWith("_") || !cmd.endsWith(".py"))
                    continue;
                commands.push(cmd.replace(/\.py$/, ""));
            }
        }
        catch {
            // ignore
        }
    }
    return [...new Set(commands)];
}
// ─── Requirements ───────────────────────────────────────────────────────────
async function parseRequirements(root) {
    const reqPath = join(root, "requirements.txt");
    if (!existsSync(reqPath))
        return [];
    try {
        const content = await readFile(reqPath, "utf-8");
        return content
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
            .map((l) => l.split(/[=<>~!^]/)[0].trim());
    }
    catch {
        return [];
    }
}
// ─── Main Analyzer ─────────────────────────────────────────────────────────
export async function analyzeDjango(root) {
    if (!isDjangoWorkspace(root))
        return null;
    const [version, settings, requirements] = await Promise.all([
        detectVersion(root),
        parseSettings(root),
        parseRequirements(root),
    ]);
    const apps = await scanDjangoApps(root);
    const managementCommands = await findManagementCommands(root);
    const drfEnabled = requirements.some((r) => r.toLowerCase().includes("djangorestframework")) ||
        settings.installedApps.some((a) => a.includes("rest_framework"));
    // Config files
    const configs = [];
    for (const cfg of ["settings.py", "urls.py", "wsgi.py", "manage.py"]) {
        const p = join(root, cfg);
        if (existsSync(p)) {
            configs.push({ name: cfg, path: p });
        }
    }
    return {
        framework: {
            id: "django",
            name: "Django",
            category: "fullstack",
            description: "Python web framework for perfectionists with deadlines",
            tags: ["python", "fullstack", "orm"],
        },
        version,
        apps,
        managementCommands,
        middleware: settings.middleware,
        drfEnabled,
        requirements,
        configs,
    };
}
//# sourceMappingURL=analyzer.js.map
/**
 * Frappe Plugin — Analyzer (RFC-0061)
 *
 * Deep analysis of Frappe/ERPNext workspaces via filesystem inspection.
 * Does NOT connect to databases or run bench commands.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// ─── Detection Helpers ──────────────────────────────────────────────────────
function isFrappeWorkspace(root) {
    return (existsSync(join(root, "sites")) ||
        existsSync(join(root, "apps.txt")) ||
        existsSync(join(root, "frappe-bench", "sites")) ||
        existsSync(join(root, "frappe-bench", "sites.txt")));
}
function findBenchPath(root) {
    const candidates = [join(root, "frappe-bench"), root];
    for (const c of candidates) {
        if (existsSync(join(c, "sites")) && existsSync(join(c, "apps.txt"))) {
            return c;
        }
    }
    return undefined;
}
// ─── Apps Discovery ─────────────────────────────────────────────────────────
async function getAppsList(benchPath) {
    const appsTxt = join(benchPath, "apps.txt");
    if (existsSync(appsTxt)) {
        try {
            const content = await readFile(appsTxt, "utf-8");
            return content
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith("#"));
        }
        catch {
            // ignore
        }
    }
    const appsDir = join(benchPath, "apps");
    if (existsSync(appsDir)) {
        try {
            const entries = await readdir(appsDir);
            return entries.filter((e) => !e.startsWith(".") && e !== "node_modules");
        }
        catch {
            // ignore
        }
    }
    return [];
}
// ─── Hooks Parser ──────────────────────────────────────────────────────────
async function parseHooksFile(hooksPath) {
    if (!existsSync(hooksPath))
        return {};
    try {
        const content = await readFile(hooksPath, "utf-8");
        const hooks = {};
        const hookPattern = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/gm;
        let match;
        while ((match = hookPattern.exec(content)) !== null) {
            const [, hookName, rawValue] = match;
            const trimmed = rawValue.trim();
            if (trimmed.startsWith("[")) {
                const listMatch = trimmed.match(/^\[(.*)\]$/s);
                if (listMatch) {
                    hooks[hookName] = listMatch[1]
                        .split(",")
                        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
                        .filter(Boolean);
                }
            }
            else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
                hooks[hookName] = [trimmed.replace(/^["']|["']$/g, "")];
            }
            else {
                hooks[hookName] = [trimmed.replace(/,.*$/, "").trim()];
            }
        }
        return hooks;
    }
    catch {
        return {};
    }
}
// ─── DocType Scanner ───────────────────────────────────────────────────────
async function countDocTypes(appPath, appName) {
    const moduleDir = join(appPath, appName, "doctype");
    if (!existsSync(moduleDir))
        return 0;
    try {
        const entries = await readdir(moduleDir);
        return entries.filter((e) => !e.startsWith(".") && !e.startsWith("_")).length;
    }
    catch {
        return 0;
    }
}
async function listDocTypes(appPath, appName) {
    const moduleDir = join(appPath, appName, "doctype");
    if (!existsSync(moduleDir))
        return [];
    try {
        const entries = await readdir(moduleDir);
        return entries.filter((e) => !e.startsWith(".") && !e.startsWith("_"));
    }
    catch {
        return [];
    }
}
async function scanDocTypeFolder(appPath, appName, doctypeName) {
    const dtDir = join(appPath, appName, "doctype", doctypeName);
    const jsonPath = join(dtDir, `${doctypeName}.json`);
    const jsPath = join(dtDir, `${doctypeName}.js`);
    let nFields = 0;
    let isSubmittable = false;
    let singleDoc = false;
    if (existsSync(jsonPath)) {
        try {
            const content = await readFile(jsonPath, "utf-8");
            const parsed = JSON.parse(content);
            nFields = Array.isArray(parsed.fields) ? parsed.fields.length : 0;
            isSubmittable = !!parsed.is_submittable;
            singleDoc = !!parsed.single;
        }
        catch {
            // ignore
        }
    }
    if (nFields === 0 && existsSync(jsPath)) {
        try {
            const content = await readFile(jsPath, "utf-8");
            const fieldsMatch = content.match(/fields\s*:\s*\[([^\]]*)\]/);
            if (fieldsMatch) {
                nFields = fieldsMatch[1].split(",").filter((f) => f.trim()).length;
            }
            isSubmittable = /is_submittable\s*:\s*1|is_submittable\s*=\s*1/.test(content);
            singleDoc = /single\s*:\s*1|single\s*=\s*1/.test(content);
        }
        catch {
            // ignore
        }
    }
    return { nFields, isSubmittable, singleDoc };
}
// ─── App Analysis ────────────────────────────────────────────────────────────
async function analyzeApp(benchPath, appName) {
    const appPath = join(benchPath, "apps", appName);
    const packageJson = await readFile(join(appPath, "package.json"), "utf-8").catch(() => "");
    let isErpNext = false;
    let hasSPA = false;
    try {
        const pkg = JSON.parse(packageJson);
        const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        isErpNext = !!(allDeps["erpnext"] || allDeps["frappe"]?.includes("erpnext"));
        hasSPA = !!(allDeps["@frappe/ui"] || allDeps["frappe-ui"]);
    }
    catch {
        // ignore
    }
    return { isErpNext, hasSPA };
}
// ─── Sites Scanner ─────────────────────────────────────────────────────────
async function scanSites(sitesPath) {
    if (!existsSync(sitesPath))
        return [];
    const sites = [];
    try {
        const entries = await readdir(sitesPath);
        for (const entry of entries) {
            if (entry.startsWith(".") || entry === "assets" || entry === "certs")
                continue;
            const sitePath = join(sitesPath, entry);
            let isDir = false;
            try {
                isDir = (await import("node:fs/promises").then((m) => m.stat(sitePath))).isDirectory();
            }
            catch {
                continue;
            }
            if (!isDir)
                continue;
            const siteConfigPath = join(sitePath, "site_config.json");
            let dbPort;
            let redisPort;
            let hasSiteConfig = false;
            if (existsSync(siteConfigPath)) {
                hasSiteConfig = true;
                try {
                    const siteConfig = JSON.parse(await readFile(siteConfigPath, "utf-8"));
                    if (siteConfig.db_port)
                        dbPort = Number(siteConfig.db_port);
                    if (siteConfig.redis_port)
                        redisPort = Number(siteConfig.redis_port);
                }
                catch {
                    // ignore
                }
            }
            sites.push({ name: entry, path: sitePath, hasSiteConfig, dbPort, redisPort });
        }
    }
    catch {
        // ignore
    }
    return sites;
}
// ─── Custom Fields (FGD-based estimation) ──────────────────────────────────
async function estimateCustomFields(benchPath) {
    let totalCustomFields = 0;
    let totalPropertySetters = 0;
    const linkedTo = new Set();
    const appsDir = join(benchPath, "apps");
    if (!existsSync(appsDir))
        return { totalCustomFields: 0, totalPropertySetters: 0, linkedTo: [] };
    let apps = [];
    try {
        apps = await readdir(appsDir);
    }
    catch {
        return { totalCustomFields: 0, totalPropertySetters: 0, linkedTo: [] };
    }
    for (const app of apps) {
        if (app.startsWith("."))
            continue;
        const fgdPath = join(appsDir, app, `${app}.fgd.json`);
        if (!existsSync(fgdPath))
            continue;
        try {
            const content = await readFile(fgdPath, "utf-8");
            const fgd = JSON.parse(content);
            if (Array.isArray(fgd)) {
                for (const group of fgd) {
                    if (Array.isArray(group.items)) {
                        for (const item of group.items) {
                            if (item.doctype === "Custom Field") {
                                totalCustomFields++;
                                if (item.fieldtype === "Link" && item.options) {
                                    linkedTo.add(item.options);
                                }
                            }
                            if (item.doctype === "Property Setter") {
                                totalPropertySetters++;
                            }
                        }
                    }
                }
            }
        }
        catch {
            // ignore
        }
    }
    return { totalCustomFields, totalPropertySetters, linkedTo: Array.from(linkedTo) };
}
// ─── Main Analyzer ─────────────────────────────────────────────────────────
/**
 * Analyze a Frappe workspace (RFC-0061)
 *
 * Scans bench directory structure, apps, DocTypes, hooks, and sites.
 * Does NOT connect to databases or run CLI commands.
 */
export async function analyzeFrappe(workspaceRoot) {
    if (!isFrappeWorkspace(workspaceRoot)) {
        return null;
    }
    const benchPath = findBenchPath(workspaceRoot) ?? workspaceRoot;
    const appsList = await getAppsList(benchPath);
    const appsInfo = [];
    const doctypesSummary = [];
    const hooksSummaries = [];
    let isErpNext = false;
    let hasSPA = false;
    for (const appName of appsList) {
        const appPath = join(benchPath, "apps", appName);
        if (!existsSync(appPath))
            continue;
        const [hooksPath, moduleEntries] = await Promise.all([
            parseHooksFile(join(appPath, appName, "hooks.py")),
            readdir(join(appPath, appName)).catch(() => []),
        ]);
        const [doctypeCount, appDetails] = await Promise.all([
            countDocTypes(appPath, appName),
            analyzeApp(benchPath, appName),
        ]);
        if (appDetails.isErpNext)
            isErpNext = true;
        if (appDetails.hasSPA)
            hasSPA = true;
        // Extract __version__ from hooks.py
        let version;
        try {
            const hooksContent = await readFile(join(appPath, appName, "hooks.py"), "utf-8");
            const versionMatch = hooksContent.match(/^__version__\s*=\s*["']([^"']+)["']/m);
            if (versionMatch)
                version = versionMatch[1];
        }
        catch {
            // ignore
        }
        appsInfo.push({
            name: appName,
            path: appPath,
            version,
            moduleCount: moduleEntries.filter((e) => !e.startsWith(".")).length,
            doctypeCount,
            hasHooks: Object.keys(hooksPath).length > 0,
            hasWorkspace: existsSync(join(appPath, appName, "Workspace")),
            hasPublicFiles: existsSync(join(appPath, "public")),
        });
        if (Object.keys(hooksPath).length > 0) {
            hooksSummaries.push({ appName, hooks: hooksPath });
        }
        // Enumerate DocTypes
        const doctypeNames = await listDocTypes(appPath, appName);
        for (const dtName of doctypeNames) {
            const { nFields, isSubmittable, singleDoc } = await scanDocTypeFolder(appPath, appName, dtName);
            const custom = dtName.startsWith("__") || dtName.startsWith("custom_");
            doctypesSummary.push({
                name: dtName,
                module: appName,
                custom,
                isSubmittable,
                singleDoc,
                nFields,
            });
        }
    }
    const sites = await scanSites(join(benchPath, "sites"));
    const customFieldInfo = await estimateCustomFields(benchPath);
    return {
        framework: {
            id: isErpNext ? "erpnext" : "frappe",
            name: isErpNext ? "ERPNext" : "Frappe",
            category: "fullstack",
            description: isErpNext
                ? "Open Source ERP for the Web"
                : "Full-stack Python web framework (Frappe)",
            tags: isErpNext
                ? ["python", "erp", "business", "fullstack"]
                : ["python", "fullstack", "bench"],
        },
        benchPath,
        sites,
        apps: appsInfo,
        doctypes: doctypesSummary,
        hooks: hooksSummaries,
        customFields: customFieldInfo,
        isErpNext,
        hasSPA,
    };
}
//# sourceMappingURL=analyzer.js.map
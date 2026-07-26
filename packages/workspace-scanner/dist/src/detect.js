import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function detectProject(rootPath) {
    const config = {};
    // Node.js detection
    const packageJsonPath = join(rootPath, "package.json");
    if (existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
            if (pkg.name)
                config.name = String(pkg.name);
            config.language = "TypeScript";
            if (pkg.workspaces)
                config.packageManager = "npm";
            if (existsSync(join(rootPath, "pnpm-lock.yaml")))
                config.packageManager = "pnpm";
            if (existsSync(join(rootPath, "yarn.lock")))
                config.packageManager = "yarn";
            if (existsSync(join(rootPath, "bun.lockb")))
                config.packageManager = "bun";
        }
        catch { /* ignore */ }
    }
    // Python detection
    if (existsSync(join(rootPath, "pyproject.toml")) ||
        existsSync(join(rootPath, "setup.py"))) {
        config.language = "Python";
        config.packageManager = "pip";
    }
    // Go detection
    if (existsSync(join(rootPath, "go.mod"))) {
        config.language = "Go";
        config.packageManager = "go";
    }
    // Rust detection
    if (existsSync(join(rootPath, "Cargo.toml"))) {
        config.language = "Rust";
        config.packageManager = "cargo";
    }
    // Frappe/ERPNext detection
    if (existsSync(join(rootPath, "sites")) ||
        existsSync(join(rootPath, "apps")) ||
        existsSync(join(rootPath, "hooks.py"))) {
        config.framework = "frappe";
    }
    // Next.js detection
    if (existsSync(join(rootPath, "next.config.js")) ||
        existsSync(join(rootPath, "next.config.ts"))) {
        config.framework = "nextjs";
    }
    // Vite detection
    if (existsSync(join(rootPath, "vite.config.js")) ||
        existsSync(join(rootPath, "vite.config.ts"))) {
        config.buildTool = "vite";
    }
    return config;
}
//# sourceMappingURL=detect.js.map
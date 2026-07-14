/**
 * CLI Plugin SDK — Main Entry (RFC-0067)
 */
import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { searchPlugins } from "./registry.js";
import { isInstalled, getInstalledPlugin, listInstalledPlugins, } from "./plugin-fs.js";
/**
 * CLI SDK for managing pi-harness plugins
 */
export class PluginCLI {
    config;
    constructor(config = {}) {
        this.config = {
            cwd: config.cwd ?? process.cwd(),
            globalDir: config.globalDir ?? "",
            registry: config.registry ?? "https://registry.npmjs.org",
            npmBin: config.npmBin ?? "npm",
        };
    }
    /** Install a plugin from npm */
    async install(name, options = {}) {
        const { version, global = false } = options;
        let normalizedName = name;
        if (!name.startsWith("@") && !name.startsWith("pi-")) {
            normalizedName = name.startsWith("plugin-")
                ? `@pi/${name}`
                : `@pi/plugin-${name}`;
            console.warn(`Normalizing "${name}" to "${normalizedName}"`);
        }
        const pkgSpec = version ? `${normalizedName}@${version}` : normalizedName;
        const args = [
            this.config.npmBin,
            "install",
            pkgSpec,
            global ? "--global" : "--save",
        ];
        if (this.config.registry) {
            args.push("--registry", this.config.registry);
        }
        await execa(args[0], args.slice(1), {
            cwd: this.config.cwd,
            stdio: "inherit",
        });
    }
    /** Remove an installed plugin */
    async remove(name) {
        if (!isInstalled(name, this.config)) {
            throw new Error(`Plugin "${name}" is not installed`);
        }
        await execa(this.config.npmBin, ["uninstall", name, "--save"], {
            cwd: this.config.cwd,
            stdio: "inherit",
        });
    }
    /** List all installed plugins */
    async list() {
        return listInstalledPlugins(this.config);
    }
    /** Update plugin(s) */
    async update(name) {
        const args = [this.config.npmBin, "update"];
        if (name)
            args.push(name);
        else
            args.push("@pi/*");
        if (this.config.registry)
            args.push("--registry", this.config.registry);
        await execa(args[0], args.slice(1), {
            cwd: this.config.cwd,
            stdio: "inherit",
        });
    }
    /** Search npm for plugins */
    async search(query) {
        const results = await Promise.all([
            searchPlugins(`@pi/plugin-${query}`, this.config.registry),
            searchPlugins(`@pi/${query}-plugin`, this.config.registry),
            searchPlugins(query, this.config.registry),
        ]);
        const seen = new Set();
        const deduped = [];
        for (const r of results.flat()) {
            if (!seen.has(r.name)) {
                seen.add(r.name);
                deduped.push(r);
            }
        }
        return deduped.slice(0, 20);
    }
    /** Invoke a plugin exported function */
    async invoke(pluginName, command, args = {}) {
        const plugin = getInstalledPlugin(pluginName, this.config);
        if (!plugin) {
            return { success: false, error: `Plugin "${pluginName}" not found` };
        }
        try {
            const pluginPath = join(plugin.path, plugin.manifest?.entryPoint ?? "dist/index.js");
            if (!existsSync(pluginPath)) {
                return {
                    success: false,
                    error: `Plugin entry not found at ${pluginPath}`,
                };
            }
            const mod = await import(pluginPath);
            const fn = mod[command] ?? mod.default?.[command];
            if (typeof fn !== "function") {
                return {
                    success: false,
                    error: `Function "${command}" not found in plugin`,
                };
            }
            const result = await fn(args);
            return { success: true, result };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    }
    /** Get path to an installed plugin */
    getPluginPath(name) {
        const plugin = getInstalledPlugin(name, this.config);
        return plugin?.path ?? null;
    }
}
//# sourceMappingURL=index.js.map
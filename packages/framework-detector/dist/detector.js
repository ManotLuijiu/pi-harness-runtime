/**
 * Framework Detector - Detector
 *
 * Main framework detection engine.
 */
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { SignatureRegistry } from "./signatures/registry.js";
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    confidenceThreshold: 0.3,
    detectVersions: true,
    resolveImplications: true,
    cache: true,
    cacheTtlMs: 5 * 60 * 1000, // 5 minutes
    timeoutMs: 30000, // 30 seconds
    signatures: [],
};
// ─── Framework Detector ────────────────────────────────────────────────────
export class FrameworkDetector {
    config;
    registry;
    scanCache = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.registry = new SignatureRegistry();
        // Add custom signatures
        if (this.config.signatures) {
            for (const sig of this.config.signatures) {
                this.registry.register(sig);
            }
        }
    }
    /**
     * Detect frameworks in a project
     */
    async detect(projectPath) {
        const startTime = Date.now();
        // Scan project
        const scanResult = await this.scan({ rootPath: projectPath });
        // Get package.json
        const packageJson = this.parsePackageJson(scanResult);
        // Detect frameworks
        const results = await this.detectFrameworks(scanResult, packageJson);
        // Determine primary framework
        const primaryFramework = this.determinePrimaryFramework(results);
        // Detect language
        const language = this.detectLanguage(scanResult);
        // Detect package manager
        const packageManager = this.detectPackageManager(scanResult);
        return {
            projectPath,
            frameworks: results,
            primaryFramework,
            language,
            packageManager,
            hasTypeScript: scanResult.configs.some((c) => c.name.includes("tsconfig")),
            hasTests: scanResult.configs.some((c) => ["jest", "vitest", "cypress", "playwright", "pytest", "rspec"].some((t) => c.name.includes(t))),
            files: scanResult.files,
            scanTimeMs: Date.now() - startTime,
        };
    }
    /**
     * Scan project files
     */
    async scan(options) {
        const { rootPath, maxDepth = 5 } = options;
        // Check cache
        const cacheKey = `${rootPath}:${maxDepth}`;
        if (this.config.cache) {
            const cached = this.scanCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
                return cached.result;
            }
        }
        const files = [];
        const configs = [];
        let packageJson;
        // Scan directory recursively
        await this.scanDirectory(rootPath, files, configs, 0, maxDepth);
        // Look for package.json
        const packagePath = join(rootPath, "package.json");
        if (existsSync(packagePath)) {
            try {
                const content = readFileSync(packagePath, "utf-8");
                packageJson = JSON.parse(content);
                configs.push({
                    path: packagePath,
                    name: "package.json",
                    content,
                    type: "package",
                });
            }
            catch {
                // Ignore parse errors
            }
        }
        // Look for other config files
        const configPatterns = [
            "tsconfig.json",
            "jsconfig.json",
            "vite.config.js",
            "vite.config.ts",
            "next.config.js",
            "next.config.mjs",
            "nuxt.config.ts",
            "webpack.config.js",
            "babel.config.js",
            "jest.config.js",
            "vitest.config.ts",
            "python.toml",
            "pyproject.toml",
            "requirements.txt",
            "go.mod",
            "Cargo.toml",
            "pom.xml",
            "build.gradle",
            "docker-compose.yml",
            "Dockerfile",
        ];
        for (const configName of configPatterns) {
            const configPath = join(rootPath, configName);
            if (existsSync(configPath)) {
                try {
                    const content = readFileSync(configPath, "utf-8");
                    configs.push({
                        path: configPath,
                        name: configName,
                        content,
                        type: this.getConfigType(configName),
                    });
                }
                catch {
                    // Ignore read errors
                }
            }
        }
        const result = {
            files,
            packageJson,
            configs,
            scanTimeMs: 0,
        };
        // Cache result
        if (this.config.cache) {
            this.scanCache.set(cacheKey, {
                result,
                timestamp: Date.now(),
            });
        }
        return result;
    }
    /**
     * Scan directory recursively
     */
    async scanDirectory(dir, files, configs, depth, maxDepth) {
        if (depth > maxDepth)
            return;
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                // Skip common directories to ignore
                if (entry.isDirectory() &&
                    [
                        "node_modules",
                        ".git",
                        "dist",
                        "build",
                        "__pycache__",
                        ".venv",
                        "venv",
                        "target",
                    ].includes(entry.name)) {
                    continue;
                }
                if (entry.isFile()) {
                    const ext = extname(entry.name);
                    const name = basename(entry.name);
                    files.push({
                        path: fullPath,
                        exists: true,
                        matches: [ext, name],
                    });
                }
                else if (entry.isDirectory()) {
                    await this.scanDirectory(fullPath, files, configs, depth + 1, maxDepth);
                }
            }
        }
        catch {
            // Ignore permission errors
        }
    }
    /**
     * Parse package.json
     */
    parsePackageJson(scanResult) {
        return scanResult.packageJson;
    }
    /**
     * Detect frameworks from scan result
     */
    async detectFrameworks(scanResult, packageJson) {
        const results = [];
        const signatures = this.registry.list();
        // Create dependency map
        const dependencies = new Set();
        if (packageJson?.dependencies) {
            for (const dep of Object.keys(packageJson.dependencies)) {
                dependencies.add(dep);
            }
        }
        if (packageJson?.devDependencies) {
            for (const dep of Object.keys(packageJson.devDependencies)) {
                dependencies.add(dep);
            }
        }
        // Create file name set
        const fileNames = new Set();
        for (const file of scanResult.files) {
            fileNames.add(basename(file.path));
            fileNames.add(extname(file.path).slice(1)); // Extension without dot
        }
        // Create config set
        const configNames = new Set();
        for (const config of scanResult.configs) {
            configNames.add(config.name);
        }
        // Check each signature
        for (const signature of signatures) {
            const matchedSignals = this.matchSignature(signature, {
                dependencies,
                fileNames,
                configNames,
                scanResult,
            });
            if (matchedSignals.length > 0) {
                const confidence = this.calculateConfidence(matchedSignals, signature);
                if (confidence >= this.config.confidenceThreshold) {
                    results.push({
                        framework: {
                            id: signature.id,
                            name: signature.name,
                            category: signature.category,
                            description: signature.description,
                            tags: signature.tags ?? [],
                        },
                        confidence,
                        signals: matchedSignals,
                        version: packageJson?.dependencies?.[signature.id],
                    });
                }
            }
        }
        // Sort by confidence
        results.sort((a, b) => b.confidence - a.confidence);
        // Resolve implications
        if (this.config.resolveImplications) {
            this.resolveImplications(results, signatures);
        }
        return results;
    }
    /**
     * Match signature against scan data
     */
    matchSignature(signature, data) {
        const matches = [];
        for (const signal of signature.signals) {
            let matched = false;
            let matchValue = "";
            switch (signal.type) {
                case "package":
                case "dependency":
                    // Check if dependency exists
                    if (data.dependencies.has(signal.pattern)) {
                        matched = true;
                        matchValue = signal.pattern;
                    }
                    break;
                case "file":
                    // Check if file exists
                    if (data.fileNames.has(signal.pattern)) {
                        matched = true;
                        matchValue = signal.pattern;
                    }
                    break;
                case "config":
                    // Check if config exists
                    if (data.configNames.has(signal.pattern)) {
                        matched = true;
                        matchValue = signal.pattern;
                    }
                    break;
                case "directory":
                    // Check if directory exists
                    for (const file of data.scanResult.files) {
                        if (file.path.includes(signal.pattern)) {
                            matched = true;
                            matchValue = signal.pattern;
                            break;
                        }
                    }
                    break;
                case "import":
                    // Check if import pattern exists in code
                    for (const config of data.scanResult.configs) {
                        if (config.content?.includes(signal.pattern)) {
                            matched = true;
                            matchValue = signal.pattern;
                            break;
                        }
                    }
                    break;
            }
            if (matched) {
                matches.push({
                    signal,
                    match: matchValue,
                    weight: signal.weight,
                });
            }
        }
        return matches;
    }
    /**
     * Calculate confidence score
     */
    calculateConfidence(matchedSignals, signature) {
        if (signature.signals.length === 0)
            return 0;
        const totalWeight = matchedSignals.reduce((sum, m) => sum + m.weight, 0);
        const maxWeight = signature.signals.reduce((sum, s) => sum + s.weight, 0);
        return maxWeight > 0 ? totalWeight / maxWeight : 0;
    }
    /**
     * Determine primary framework
     */
    determinePrimaryFramework(results) {
        if (results.length === 0)
            return undefined;
        // Return the highest confidence result
        return results[0];
    }
    /**
     * Detect programming language
     */
    detectLanguage(scanResult) {
        const extCounts = {};
        for (const file of scanResult.files) {
            const ext = extname(file.path).toLowerCase();
            if (ext) {
                extCounts[ext] = (extCounts[ext] ?? 0) + 1;
            }
        }
        // Language detection based on extensions
        const langMap = {
            ".ts": "TypeScript",
            ".tsx": "TypeScript",
            ".js": "JavaScript",
            ".jsx": "JavaScript",
            ".py": "Python",
            ".java": "Java",
            ".go": "Go",
            ".rs": "Rust",
            ".rb": "Ruby",
            ".php": "PHP",
            ".cs": "C#",
            ".cpp": "C++",
            ".c": "C",
            ".swift": "Swift",
            ".kt": "Kotlin",
            ".dart": "Dart",
        };
        let maxCount = 0;
        let detectedLang = "";
        for (const [ext, lang] of Object.entries(langMap)) {
            if ((extCounts[ext] ?? 0) > maxCount) {
                maxCount = extCounts[ext] ?? 0;
                detectedLang = lang;
            }
        }
        return detectedLang || undefined;
    }
    /**
     * Detect package manager
     */
    detectPackageManager(scanResult) {
        const names = new Set(scanResult.configs.map((c) => c.name));
        if (names.has("pnpm-lock.yaml"))
            return "pnpm";
        if (names.has("yarn.lock"))
            return "yarn";
        if (names.has("bun.lockb"))
            return "bun";
        if (names.has("package-lock.json"))
            return "npm";
        return undefined;
    }
    /**
     * Resolve framework implications
     */
    resolveImplications(results, signatures) {
        for (const result of results) {
            const signature = signatures.find((s) => s.id === result.framework.id);
            if (!signature?.implies)
                continue;
            for (const impliedId of signature.implies) {
                // Check if already detected
                if (results.some((r) => r.framework.id === impliedId))
                    continue;
                // Check if signature exists
                const impliedSig = signatures.find((s) => s.id === impliedId);
                if (!impliedSig)
                    continue;
                // Add implied framework with reduced confidence
                results.push({
                    framework: {
                        id: impliedSig.id,
                        name: impliedSig.name,
                        category: impliedSig.category,
                        description: impliedSig.description,
                        tags: impliedSig.tags ?? [],
                    },
                    confidence: result.confidence * 0.8, // Reduced confidence for implied
                    signals: [],
                    metadata: { implied: true, from: result.framework.id },
                });
            }
        }
        // Re-sort after adding implied frameworks
        results.sort((a, b) => b.confidence - a.confidence);
    }
    /**
     * Get config type
     */
    getConfigType(configName) {
        if (configName.endsWith(".json"))
            return "json";
        if (configName.endsWith(".js") || configName.endsWith(".mjs"))
            return "javascript";
        if (configName.endsWith(".ts"))
            return "typescript";
        if (configName.endsWith(".yml") || configName.endsWith(".yaml"))
            return "yaml";
        if (configName.endsWith(".toml"))
            return "toml";
        if (configName.endsWith(".xml"))
            return "xml";
        return "unknown";
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.scanCache.clear();
    }
    /**
     * Get registry
     */
    getRegistry() {
        return this.registry;
    }
}
// ─── Factory Function ──────────────────────────────────────────────────────
/**
 * Create a framework detector
 */
export function createFrameworkDetector(config) {
    return new FrameworkDetector(config);
}
//# sourceMappingURL=detector.js.map
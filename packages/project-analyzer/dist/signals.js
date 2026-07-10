/**
 * Detection Signals
 *
 * Generic detection signals for common project types.
 * These are used by the analyzer when no specific plugin matches.
 */
/**
 * Standard detection signals for common frameworks.
 */
export const GENERIC_SIGNALS = [
    // Frappe signals
    { id: "frappe_hooks", pattern: "apps.txt", weight: 0.8, framework: "frappe" },
    { id: "frappe_sites", pattern: "sites/", weight: 0.7, framework: "frappe" },
    { id: "frappe_bench", pattern: "Procfile", weight: 0.5, framework: "frappe" },
    {
        id: "frappe_app",
        pattern: "pyproject.toml",
        weight: 0.4,
        framework: "frappe",
        metadata: { python: "true" },
    },
    // Frappe SPA signals
    {
        id: "frappe_spa_frontend",
        pattern: "frontend/",
        weight: 0.6,
        framework: "frappe_spa",
    },
    {
        id: "frappe_spa_vite",
        pattern: "vite.config.*",
        weight: 0.5,
        framework: "frappe_spa",
    },
    {
        id: "frappe_spa_typescript",
        pattern: "tsconfig.json",
        weight: 0.3,
        framework: "frappe_spa",
    },
    // Next.js signals
    {
        id: "next_config",
        pattern: "next.config.*",
        weight: 0.9,
        framework: "nextjs",
    },
    { id: "next_app_dir", pattern: "app/", weight: 0.7, framework: "nextjs" },
    { id: "next_pages", pattern: "pages/", weight: 0.6, framework: "nextjs" },
    {
        id: "next_package",
        pattern: "package.json",
        weight: 0.3,
        framework: "nextjs",
        metadata: { hasNext: "true" },
    },
    // React signals
    {
        id: "react_index",
        pattern: "src/index.*",
        weight: 0.7,
        framework: "react",
    },
    { id: "react_app", pattern: "src/App.*", weight: 0.6, framework: "react" },
    {
        id: "react_package",
        pattern: "package.json",
        weight: 0.3,
        framework: "react",
        metadata: { hasReact: "true" },
    },
    // Vite signals
    {
        id: "vite_config",
        pattern: "vite.config.*",
        weight: 0.8,
        framework: "vite",
    },
    { id: "vite_entry", pattern: "index.html", weight: 0.5, framework: "vite" },
    {
        id: "vite_tsconfig",
        pattern: "tsconfig.json",
        weight: 0.3,
        framework: "vite",
    },
    // Django signals
    {
        id: "django_manage",
        pattern: "manage.py",
        weight: 0.9,
        framework: "django",
    },
    {
        id: "django_settings",
        pattern: "settings.py",
        weight: 0.7,
        framework: "django",
    },
    {
        id: "django_requirements",
        pattern: "requirements.txt",
        weight: 0.5,
        framework: "django",
    },
    // Laravel signals
    {
        id: "laravel_artisan",
        pattern: "artisan",
        weight: 0.9,
        framework: "laravel",
    },
    {
        id: "laravel_composer",
        pattern: "composer.json",
        weight: 0.6,
        framework: "laravel",
    },
    {
        id: "laravel_database",
        pattern: "database/",
        weight: 0.5,
        framework: "laravel",
    },
    // Express signals
    {
        id: "express_package",
        pattern: "package.json",
        weight: 0.4,
        framework: "express",
        metadata: { hasExpress: "true" },
    },
    {
        id: "express_index",
        pattern: "index.js",
        weight: 0.5,
        framework: "express",
    },
    { id: "express_app", pattern: "app.js", weight: 0.5, framework: "express" },
    // FastAPI signals
    { id: "fastapi_main", pattern: "main.py", weight: 0.6, framework: "fastapi" },
    {
        id: "fastapi_requirements",
        pattern: "requirements.txt",
        weight: 0.4,
        framework: "fastapi",
    },
    {
        id: "fastapi_uvicorn",
        pattern: "package.json",
        weight: 0.3,
        framework: "fastapi",
        metadata: { hasFastAPI: "true" },
    },
];
// ─── Signal Scanner ───────────────────────────────────────────────────
/**
 * Scan for detection signals in the filesystem.
 */
export async function scanSignals(fs, signals = GENERIC_SIGNALS) {
    const results = [];
    for (const signal of signals) {
        try {
            // Handle glob patterns
            if (signal.pattern.includes("*")) {
                const matches = await fs.glob(signal.pattern);
                for (const match of matches) {
                    results.push({
                        type: signal.id,
                        path: match,
                        weight: signal.weight,
                        value: signal.metadata?.value,
                    });
                }
            }
            else {
                // Handle exact file match
                if (await fs.exists(signal.pattern)) {
                    results.push({
                        type: signal.id,
                        path: signal.pattern,
                        weight: signal.weight,
                        value: signal.metadata?.value,
                    });
                }
            }
        }
        catch {
            // Ignore errors for individual signals
        }
    }
    return results;
}
/**
 * Group signals by framework category.
 */
export function groupSignalsByFramework(signals, frameworkMap) {
    const grouped = new Map();
    for (const signal of signals) {
        const definition = GENERIC_SIGNALS.find((s) => s.id === signal.type);
        if (definition) {
            const existing = grouped.get(definition.framework) || [];
            existing.push(signal);
            grouped.set(definition.framework, existing);
        }
    }
    return grouped;
}
/**
 * Calculate confidence score from signals.
 */
export function calculateSignalConfidence(signals, requiredSignals) {
    if (signals.length === 0)
        return 0;
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const maxPossibleWeight = requiredSignals * 1.0; // Assuming max weight of 1.0 per signal
    return Math.min(1, totalWeight / maxPossibleWeight);
}
// ─── Generic Framework Detector ──────────────────────────────────────
/**
 * Generic framework detector using signal-based detection.
 */
export class GenericFrameworkDetector {
    signals;
    signalsPerFramework;
    constructor(signals = GENERIC_SIGNALS) {
        this.signals = signals;
        this.signalsPerFramework = new Map();
        // Group signals by framework
        for (const signal of signals) {
            const existing = this.signalsPerFramework.get(signal.framework) || [];
            existing.push(signal);
            this.signalsPerFramework.set(signal.framework, existing);
        }
    }
    /**
     * Detect frameworks using signals.
     */
    async detect(fs) {
        const allSignals = await scanSignals(fs, this.signals);
        const grouped = groupSignalsByFramework(allSignals, this.signalsPerFramework);
        const results = [];
        for (const [framework, signals] of grouped) {
            const definitions = this.signalsPerFramework.get(framework) || [];
            const requiredCount = Math.max(2, Math.ceil(definitions.length * 0.3));
            const confidence = calculateSignalConfidence(signals, requiredCount);
            if (confidence > 0.2) {
                results.push({
                    category: framework,
                    confidence,
                    signals,
                    version: undefined,
                });
            }
        }
        // Sort by confidence descending
        results.sort((a, b) => b.confidence - a.confidence);
        return results;
    }
}
// ─── Composite Plugin ──────────────────────────────────────────────────
/**
 * Create a composite plugin from generic signals and custom plugins.
 */
export function createCompositePlugin(customPlugins) {
    const detector = new GenericFrameworkDetector();
    return {
        id: "composite",
        version: "1.0.0",
        priority: 1000,
        async detect(fs) {
            const results = await detector.detect(fs);
            if (results.length === 0)
                return null;
            return results[0]; // Return highest confidence
        },
        async analyze(_root, detection, fs) {
            // Try custom plugins first
            for (const plugin of customPlugins) {
                if (plugin.priority < 1000) {
                    const result = await plugin.analyze(_root, detection, fs);
                    if (Object.keys(result).length > 0) {
                        return result;
                    }
                }
            }
            return {};
        },
    };
}
//# sourceMappingURL=signals.js.map
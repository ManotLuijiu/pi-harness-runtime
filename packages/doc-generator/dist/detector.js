/**
 * Doc Generator — Project Detection (RFC-0014)
 */
const SIGNALS = {
    frappe_erpnext: [
        { pattern: /frappe-bench|hooks\.py/, weight: 0.3 },
        { pattern: /doctype[/\\]/, weight: 0.4 },
        { pattern: /\bapps\/[^/]+\/[^/]+\.py\b/, weight: 0.2 },
    ],
    frappe_spa: [
        { pattern: /frappe-bench\/apps\/[^/]+\/frontend/, weight: 0.4 },
        { pattern: /vite\.config\./, weight: 0.3 },
        { pattern: /frappe\.call|frappe\.ui\./, weight: 0.3 },
    ],
    nextjs: [
        { pattern: /next\.config\./, weight: 0.4 },
        { pattern: /\/(app|pages)\/[^/]+\.(tsx|jsx|ts|js)/, weight: 0.3 },
        { pattern: /"next"|'next'/, weight: 0.2 },
    ],
    react_vite: [
        { pattern: /vite\.config\.(ts|js|mjs)/, weight: 0.4 },
        { pattern: /src\/main\.(tsx|jsx)/, weight: 0.3 },
        { pattern: /index\.html/, weight: 0.2 },
    ],
    django: [
        { pattern: /manage\.py/, weight: 0.4 },
        { pattern: /settings\.py/, weight: 0.3 },
        { pattern: /models?\.py/, weight: 0.2 },
    ],
    laravel: [
        { pattern: /artisan/, weight: 0.4 },
        { pattern: /database\/seeders/, weight: 0.3 },
        { pattern: /composer\.json/, weight: 0.2 },
    ],
    generic_web: [
        { pattern: /package\.json/, weight: 0.2 },
        { pattern: /index\.(html?|js|ts)/, weight: 0.2 },
    ],
    unknown: [],
};
const SEED_STRATEGIES = {
    frappe_erpnext: "frappe_doc_insert",
    frappe_spa: "frappe_fixtures",
    nextjs: "nextjs_factory",
    react_vite: "vite_seed",
    django: "django_migrations",
    laravel: "laravel_seeders",
    generic_web: "generic_faker",
    unknown: "generic_faker",
};
const E2E_STRATEGIES = {
    frappe_erpnext: "bench_site_browser_flow",
    frappe_spa: "api_plus_spa_flow",
    nextjs: "nextjs_dev_server_flow",
    react_vite: "vite_dev_server_flow",
    django: "django_test_client_flow",
    laravel: "laravel_dusk_flow",
    generic_web: "playwright_generic_flow",
    unknown: "playwright_generic_flow",
};
/** Detect project type from a list of file paths. */
export function detectProjectType(filePaths) {
    const scores = {
        frappe_erpnext: 0, frappe_spa: 0, nextjs: 0, react_vite: 0,
        django: 0, laravel: 0, generic_web: 0, unknown: 0,
    };
    const signals = [];
    for (const filePath of filePaths) {
        for (const [pType, pSignals] of Object.entries(SIGNALS)) {
            for (const { pattern, weight } of pSignals) {
                if (pattern.test(filePath)) {
                    scores[pType] += weight;
                    signals.push(filePath);
                }
            }
        }
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const projectType = best[1] > 0 ? best[0] : "unknown";
    return {
        projectType,
        confidence: Math.min(best[1], 1),
        signals: [...new Set(signals)],
        recommendedSeedStrategy: SEED_STRATEGIES[projectType],
        recommendedE2EStrategy: E2E_STRATEGIES[projectType],
    };
}
/** Parse signals from a directory listing. */
export function parseSignals(entries) {
    return entries.filter((e) => /[./]/.test(e));
}
//# sourceMappingURL=detector.js.map
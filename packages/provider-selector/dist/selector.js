/**
 * Provider Selector — multi-criteria provider ranking and selection (RFC-0012)
 */
/** Normalize a provider metric across all providers (0=lowest, 1=highest). */
function normalize(values) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min)
        return values.map(() => 0.5);
    return values.map((v) => (v - min) / (max - min));
}
/** Cost score: cheaper = higher score. */
function costScore(p, all) {
    const costs = all.map((x) => x.inputCostPer1M + x.outputCostPer1M);
    const norm = normalize(costs);
    const idx = all.indexOf(p);
    return 1 - norm[idx]; // invert: lower cost = higher score
}
/** Latency score: faster = higher score. */
function latencyScore(p, all) {
    const lats = all.map((x) => x.latencyMs);
    const norm = normalize(lats);
    const idx = all.indexOf(p);
    return 1 - norm[idx]; // invert: lower latency = higher score
}
function qualityScoreFn(p) {
    return p.qualityScore / 100;
}
function combinedScore(p, criteria, all) {
    const c = costScore(p, all);
    const l = latencyScore(p, all);
    const q = qualityScoreFn(p);
    switch (criteria) {
        case "cost":
            return c * 0.8 + q * 0.1 + l * 0.1;
        case "latency":
            return l * 0.7 + q * 0.2 + c * 0.1;
        case "quality":
            return q * 0.9 + l * 0.05 + c * 0.05;
        case "balanced":
            return c * 0.33 + l * 0.33 + q * 0.34;
        default:
            return q;
    }
}
/** Select the best provider based on criteria. */
export function selectProvider(providers, criteria = "balanced") {
    const available = providers.filter((p) => p.available);
    if (available.length === 0)
        return null;
    const scored = available.map((p) => ({
        provider: p,
        score: combinedScore(p, criteria, available),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const alternatives = scored.slice(1).map((s) => s.provider);
    return {
        provider: best.provider,
        reason: `Selected ${best.provider.name} (score: ${(best.score * 100).toFixed(1)}%) based on ${criteria} priority`,
        score: best.score,
        alternatives,
    };
}
/** Rank all providers by score. */
export function rank(providers, criteria = "balanced") {
    return providers
        .filter((p) => p.available)
        .map((p) => ({ p, score: combinedScore(p, criteria, providers) }))
        .sort((a, b) => b.score - a.score)
        .map((s) => s.p);
}
/** Compare two providers by cost. Returns negative if a is cheaper. */
export function compareCost(a, b) {
    const aCost = a.inputCostPer1M + a.outputCostPer1M;
    const bCost = b.inputCostPer1M + b.outputCostPer1M;
    return aCost - bCost;
}
/** Compare two providers by latency. Returns negative if a is faster. */
export function compareLatency(a, b) {
    return a.latencyMs - b.latencyMs;
}
/** Filter providers by capability. */
export function filterByCapability(providers, capability) {
    return providers.filter((p) => p.capabilities.includes(capability));
}
/** Filter providers by region. */
export function filterByRegion(providers, region) {
    if (region === "global")
        return providers;
    return providers.filter((p) => p.region === region || p.region === "global");
}
//# sourceMappingURL=selector.js.map
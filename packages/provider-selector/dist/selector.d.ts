/**
 * Provider Selector — multi-criteria provider ranking and selection (RFC-0012)
 */
import type { Provider, SelectionCriteria, SelectionResult } from "./types.js";
/** Select the best provider based on criteria. */
export declare function selectProvider(providers: Provider[], criteria?: SelectionCriteria): SelectionResult | null;
/** Rank all providers by score. */
export declare function rank(providers: Provider[], criteria?: SelectionCriteria): Provider[];
/** Compare two providers by cost. Returns negative if a is cheaper. */
export declare function compareCost(a: Provider, b: Provider): number;
/** Compare two providers by latency. Returns negative if a is faster. */
export declare function compareLatency(a: Provider, b: Provider): number;
/** Filter providers by capability. */
export declare function filterByCapability(providers: Provider[], capability: Provider["capabilities"][number]): Provider[];
/** Filter providers by region. */
export declare function filterByRegion(providers: Provider[], region: Provider["region"]): Provider[];
//# sourceMappingURL=selector.d.ts.map
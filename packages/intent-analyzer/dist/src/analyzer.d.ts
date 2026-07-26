/**
 * Intent Analyzer — Analyzer
 *
 * Keyword-based intent detection.
 */
import type { Intent, IntentRule } from "./types.js";
export declare class IntentAnalyzer {
    private rules;
    constructor(rules?: IntentRule[]);
    analyze(text: string): Intent;
    analyzeBatch(texts: string[]): Intent[];
}
//# sourceMappingURL=analyzer.d.ts.map
import { IntentAnalyzer } from "./analyzer.js";
import type { Intent } from "./types.js";
export type PingPongDecision = "run_ping_pong" | "suggest_ping_pong" | "handle_inline";
export interface CodebaseComplexityInput {
    /** Approximate total source/config/documentation files in the current repo. */
    fileCount?: number;
    /** Number of top-level packages/apps/workspaces. */
    packageCount?: number;
    /** Number of framework/runtime signals found, such as package.json, Cargo.toml, or pyproject.toml. */
    frameworkSignalCount?: number;
    /** Number of changed files in the working tree, if known. */
    changedFileCount?: number;
    /** Paths the user explicitly mentioned. */
    mentionedPaths?: string[];
    /** True when tests already exist and changes should usually preserve them. */
    hasTests?: boolean;
    /** True when release/build automation exists. */
    hasCiOrRelease?: boolean;
}
export interface PingPongDecisionOptions {
    /** Project-level complexity signals. Pass scanCodebaseComplexity(cwd) when available. */
    codebase?: CodebaseComplexityInput;
    /** Lower thresholds for fully autonomous sessions. */
    autonomous?: boolean;
    /** Allow exact user override words. Default: true. */
    allowExplicitOverride?: boolean;
}
export interface PingPongSignal {
    id: string;
    label: string;
    weight: number;
}
export interface PingPongDecisionResult {
    decision: PingPongDecision;
    score: number;
    thresholds: {
        run: number;
        suggest: number;
    };
    intent: Intent;
    signals: PingPongSignal[];
    reasons: string[];
}
export declare class PingPongDecisionEngine {
    private readonly intentAnalyzer;
    constructor(intentAnalyzer?: IntentAnalyzer);
    analyze(request: string, options?: PingPongDecisionOptions): PingPongDecisionResult;
    private addCodebaseSignals;
}
export interface ScanCodebaseOptions {
    maxFiles?: number;
    maxDepth?: number;
}
export declare function scanCodebaseComplexity(root: string, options?: ScanCodebaseOptions): CodebaseComplexityInput;
export declare function analyzePingPongDecision(request: string, options?: PingPongDecisionOptions): PingPongDecisionResult;
//# sourceMappingURL=ping-pong.d.ts.map
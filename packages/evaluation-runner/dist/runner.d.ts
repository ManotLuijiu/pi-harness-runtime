/**
 * Evaluation Runner — Core (RFC-0020)
 */
import type { EvaluationConfig, EvaluationInput, EvaluatorFn, EvaluationReport, EvaluationSuite } from "./types.js";
export declare class EvaluationRunner {
    private evaluators;
    private config;
    constructor(config?: EvaluationConfig);
    registerEvaluator(name: string, fn: EvaluatorFn): void;
    runSuite(suite: EvaluationSuite, execute: (input: EvaluationInput) => Promise<string>): Promise<EvaluationReport>;
    private runCase;
    listEvaluators(): string[];
}
export declare const exactMatchEvaluator: EvaluatorFn;
export declare const substringMatchEvaluator: EvaluatorFn;
export declare const lengthEvaluator: EvaluatorFn;
//# sourceMappingURL=runner.d.ts.map
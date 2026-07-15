/**
 * Autonomous Refactor — Planning Engine (RFC-0092)
 */
import type { RefactorFinding, RefactorPlan, RefactorConfig, RiskLevel } from "./types.js";
export declare function createPlan(findings: RefactorFinding[], config?: Partial<RefactorConfig>): RefactorPlan;
export declare function filterByRisk(findings: RefactorFinding[], maxRisk: RiskLevel): RefactorFinding[];
export declare function groupByFile(findings: RefactorFinding[]): Map<string, RefactorFinding[]>;
export declare function groupByType(findings: RefactorFinding[]): Map<RefactorFinding["type"], RefactorFinding[]>;
//# sourceMappingURL=planner.d.ts.map
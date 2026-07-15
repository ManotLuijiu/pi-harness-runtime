/**
 * Autonomous Refactor — Pattern Detection (RFC-0092)
 */
import type { RefactorFinding, RiskLevel } from "./types.js";
export declare function detectRefactorings(files: Array<{
    path: string;
    content: string;
}>): RefactorFinding[];
export declare function assessRisk(finding: RefactorFinding): RiskLevel;
export declare function calculatePriority(finding: RefactorFinding): number;
//# sourceMappingURL=detector.d.ts.map
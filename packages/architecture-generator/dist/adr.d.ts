/**
 * Architecture Generator - RFC-0073
 *
 * Generate Architecture Decision Records.
 */
import type { ADR } from './types.js';
/**
 * Generate an ADR file
 */
export declare function generateADR(adr: ADR): string;
/**
 * Create a new ADR
 */
export declare function createADR(id: string, title: string, context: string, decision: string, consequences: string): ADR;
//# sourceMappingURL=adr.d.ts.map
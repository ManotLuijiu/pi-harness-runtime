/**
 * Architecture Generator - RFC-0073
 *
 * Generate Architecture Decision Records.
 */

import type { ADR } from "./types.js";

/**
 * Generate an ADR file
 */
export function generateADR(adr: ADR): string {
	return `# ${adr.id}: ${adr.title}

## Status
${adr.status}

## Context
${adr.context}

## Decision
${adr.decision}

## Consequences
${adr.consequences}

---
*Created: ${adr.createdAt}*
`;
}

/**
 * Create a new ADR
 */
export function createADR(
	id: string,
	title: string,
	context: string,
	decision: string,
	consequences: string,
): ADR {
	return {
		id,
		title,
		status: "proposed",
		context,
		decision,
		consequences,
		createdAt: new Date().toISOString().split("T")[0],
	};
}

/**
 * Architecture Generator - RFC-0073
 *
 * Generate Architecture Decision Records.
 */
/**
 * Generate an ADR file
 */
export function generateADR(adr) {
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
export function createADR(id, title, context, decision, consequences) {
    return {
        id,
        title,
        status: 'proposed',
        context,
        decision,
        consequences,
        createdAt: new Date().toISOString().split('T')[0],
    };
}
//# sourceMappingURL=adr.js.map
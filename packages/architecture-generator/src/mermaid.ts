/**
 * Architecture Generator - RFC-0073
 *
 * Generate Mermaid diagrams.
 */

import type { ArchitectureDiagram, DiagramType, ArchitectureAnalysis } from './types.js';

/**
 * Generate component diagram
 */
export function generateComponentDiagram(analysis: ArchitectureAnalysis): ArchitectureDiagram {
  const mermaid = [
    'graph TB',
    '    subgraph Layers',
    ...analysis.layers.map((layer, i) => {
      const nodes = analysis.components.filter((_, j) => j % analysis.layers.length === i);
      return `        ${nodes.join(' --> ')}`;
    }),
    '    end',
    ...analysis.dependencies.map(d => `    ${d.from} --> ${d.to}`),
  ].join('\n');

  return {
    type: 'component',
    title: 'Architecture Components',
    mermaid,
    description: 'Component diagram showing layers and dependencies',
  };
}

/**
 * Generate sequence diagram
 */
export function generateSequenceDiagram(
  title: string,
  steps: { actor: string; action: string; target: string }[]
): ArchitectureDiagram {
  const mermaid = [
    'sequenceDiagram',
    ...steps.map(
      s => `    ${s.actor}->>+${s.target}: ${s.action}`
    ),
  ].join('\n');

  return {
    type: 'sequence',
    title,
    mermaid,
    description: 'Sequence diagram showing interaction flow',
  };
}

/**
 * Generate flow diagram
 */
export function generateFlowDiagram(
  title: string,
  nodes: { id: string; label: string }[],
  edges: { from: string; to: string; label?: string }[]
): ArchitectureDiagram {
  const mermaid = [
    'flowchart LR',
    ...nodes.map(n => `    ${n.id}[${n.label}]`),
    ...edges.map(
      e => `    ${e.from}${e.label ? `-->|"${e.label}"|` : '->>'}${e.to}`
    ),
  ].join('\n');

  return {
    type: 'flow',
    title,
    mermaid,
    description: 'Flow diagram showing process flow',
  };
}

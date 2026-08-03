# RFC-0106 — Knowledge Graph and Provenance Projection

> **Status:** proposed
> **Author:** pi-harness-runtime
> **Replaces:** N/A
> **Superseded by:** N/A
> **Depends on:** RFC-0105 (Knowledge Retrieval)

---

## Summary

Extend TencentDB-Agent-Memory's CodeGraph to index all `moocoding-skills/*/SKILL.md` files as OKF encyclopedia with typed nodes and edges, creating a navigable knowledge graph with provenance linking to `RFC/*` and `IMPLEMENTATION/*`.

---

## Motivation

**Current state:**

```
moocoding-skills/skills/
  ├── debug-typescript-errors/SKILL.md
  ├── frappe-custom-field/SKILL.md
  └── ... (many skills, hard to navigate)
```

**Problems:**

- No graph relationships between skills
- No provenance (which RFC implemented this?)
- No versioning / supersession tracking
- Hard to find "what skill handles X?"

**Solution:**

```
Knowledge Graph
  ├── Nodes: skills, RFCs, implementations, concepts
  ├── Edges: implements, depends_on, supersedes, related_to
  └── Provenance: links to RFC/* and IMPLEMENTATION/*
```

---

## Architecture

```
+------------------+
| moocoding-skills/ |
| SKILL.md files    |
+------------------+
        ↓ extract
+------------------------+
| TencentDB-Agent-Memory |
| CodeGraph + Wiki       |
+------------------------+
        ↓ extend
+------------------------+
| Knowledge Graph Layer    |
| - Typed nodes           |
| - Provenance edges     |
| - Version tracking      |
+------------------------+
```

---

## Node Types

```typescript
type GraphNodeType =
  | 'skill'      // SKILL.md entry
  | 'rfc'        // RFC document
  | 'implementation'  // IMPLEMENTATION/* entry
  | 'concept'    // Abstract concept
  | 'api'        // API endpoint
  | 'cli'        // CLI command
  | 'pattern'    // Code pattern
  | 'workflow';  // Workflow/SOP

interface KnowledgeNode {
  id: string;           // e.g., "skill:frappe-custom-field"
  type: GraphNodeType;
  title: string;
  description: string;
  content: string;       // Full SKILL.md content
  metadata: {
    source: string;     // File path
    tags: string[];
    version: string;
    created: string;
    updated: string;
  };
}
```

---

## Edge Types

```typescript
type GraphEdgeType =
  | 'implements'      // Skill implements RFC
  | 'depends_on'       // Skill A depends on Skill B
  | 'supersedes'      // New version replaces old
  | 'related_to'       // General relationship
  | 'authored_by'      // Author attribution
  | 'validates'        // Tests/validates concept
  | 'references';      // RFC references implementation

interface KnowledgeEdge {
  id: string;
  source: string;      // Node ID
  target: string;      // Node ID
  type: GraphEdgeType;
  metadata: {
    confidence?: number;  // 0-1
    source?: string;    // How was this edge discovered
    created: string;
  };
}
```

---

## Provenance Mapping

```
RFC-0103 (Session Event Runtime)
        ↓ implements
IMPLEMENTATION/RFC-0103/
        ↓ contains
packages/event-store/
        ↓ documents
packages/event-bus/
        ↓ described_by
SKILL.md: event-bus-usage

Knowledge Graph Edge: skill:event-bus-usage --implements--> rfc:RFC-0103
```

---

## SKILL.md OKF Structure

```markdown
---
id: frappe-custom-field-lifecycle
type: skill
title: Frappe Custom Field Lifecycle
tags: [frappe, custom-field, database, migration]
version: 1.0.0
provenance:
  implements: RFC-XXXX
  related_implementation: IMPLEMENTATION/RFC-XXXX
---

# Frappe Custom Field Lifecycle

## When to Use
...

## Procedure
...

## Pitfalls
...

## Related Skills
- skill:frappe-doctype-field-order
- skill:property-setter-pattern
```

---

## Knowledge Extraction Pipeline

```typescript
// Extract knowledge from SKILL.md files
async function extractKnowledgeGraph() {
  const skillsDir = 'moocoding-skills/skills/';

  for (const skillPath of glob(skillsDir + '*/SKILL.md')) {
    const content = readFile(skillPath);
    const okf = parseOKF(content);

    // Create node
    const node = createNode(okf);
    await graph.addNode(node);

    // Extract edges from provenance frontmatter
    for (const edge of okf.metadata.provenance) {
      await graph.addEdge(edge);
    }

    // Link to RFC if referenced
    const rfcRefs = extractRFCRefs(content);
    for (const rfc of rfcRefs) {
      await graph.addEdge({
        source: node.id,
        target: `rfc:${rfc}`,
        type: 'implements'
      });
    }

    // Link to implementation
    const implRefs = extractImplRefs(content);
    for (const impl of implRefs) {
      await graph.addEdge({
        source: node.id,
        target: `implementation:${impl}`,
        type: 'documents'
      });
    }
  }
}
```

---

## Graph Queries

```typescript
// Find skill that implements RFC-0103
await graph.query({
  type: 'implements',
  target: 'rfc:RFC-0103'
});

// Find all skills related to "typescript"
await graph.query({
  type: 'related_to',
  filter: { tags: ['typescript'] }
});

// Find supersession chain
await graph.query({
  type: 'supersedes',
  source: 'skill:old-skill-name'
});
```

---

## MCP Integration

```typescript
interface KnowledgeGraphMCP {
  // Query graph
  kg_query(query: GraphQuery): Promise<GraphResult[]>;

  // Get node details
  kg_node(id: string): Promise<KnowledgeNode>;

  // Get edges from node
  kg_edges(nodeId: string): Promise<KnowledgeEdge[]>;

  // Navigate path
  kg_path(from: string, to: string): Promise<string[]>;

  // Find by concept
  kg_find(concept: string): Promise<KnowledgeNode[]>;
}
```

---

## Future: Neo4j Migration

```
Current: TencentDB-Agent-Memory (SQLite)
Future:  Neo4j (when budget allows)

Migration path:
1. Export graph to Cypher
2. Import to Neo4j
3. Update MCP adapter
4. Deprecate CodeGraph extension
```

---

## Files

See `IMPLEMENTATION/RFC-0106/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0106/ACCEPTANCE_CRITERIA.md`.

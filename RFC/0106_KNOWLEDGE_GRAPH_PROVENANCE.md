# RFC-0106 — Knowledge Graph and Provenance Projection

> **Status:** proposed
> **Author:** pi-harness-runtime
> **Replaces:** N/A
> **Superseded by:** N/A
> **Depends on:** RFC-0105 (Knowledge Retrieval)

---

## Summary

Extend TencentDB-Agent-Memory's Knowledge Service (8424) to index all `moocoding-skills/*/SKILL.md` files as OKF encyclopedia with typed nodes and edges, creating a navigable knowledge graph with provenance linking to `RFC/*` and `IMPLEMENTATION/*`.

---

## Knowledge Service API (Port 8424)

Base URL: `http://{host}:8424/v3`

### Wiki Documents

```bash
# Create/update document
POST /v3/wiki/documents
Headers:
  x-tdai-user-key: {user_key}
  x-tdai-service-id: {service_id}
Body:
{
  "title": "Frappe Custom Field Lifecycle",
  "content": "# Frappe Custom Field Lifecycle\n\n## When to Use\n...",
  "tags": ["frappe", "custom-field"],
  "team_id": "moocoding"
}

# Get document
GET /v3/wiki/documents/{document_id}
Headers: x-tdai-user-key, x-tdai-service-id

# List documents
GET /v3/wiki/documents?team_id={team_id}&limit=100
Headers: x-tdai-user-key, x-tdai-service-id

# Delete document
DELETE /v3/wiki/documents/{document_id}
Headers: x-tdai-user-key, x-tdai-service-id
```

### Knowledge Graph

```bash
# Sync nodes and edges
POST /v3/knowledge/graph/sync
Headers: x-tdai-user-key, x-tdai-service-id
Body:
{
  "nodes": [
    {
      "id": "skill:frappe-custom-field-lifecycle",
      "type": "skill",
      "data": {
        "title": "Frappe Custom Field Lifecycle",
        "description": "...",
        "tags": ["frappe", "custom-field"],
        "source": "frappe-bench/.claude-plugins/moocoding-skills/skills/frappe-custom-field-lifecycle/SKILL.md"
      }
    },
    {
      "id": "rfc:RFC-0052",
      "type": "rfc",
      "data": {
        "title": "RFC-0052 Skill Registry Fix",
        "source": "RFC/0052_SKILL_REGISTRY_FIX.md"
      }
    }
  ],
  "edges": [
    {
      "from": "skill:frappe-custom-field-lifecycle",
      "to": "rfc:RFC-0052",
      "type": "implements"
    }
  ]
}

# Search graph
POST /v3/knowledge/graph/search
Headers: x-tdai-user-key, x-tdai-service-id
Body:
{
  "query": "frappe custom field",
  "limit": 10
}

# Query by relationship
POST /v3/knowledge/graph/query
Headers: x-tdai-user-key, x-tdai-service-id
Body:
{
  "type": "implements",
  "from": "skill:frappe-custom-field-lifecycle"
}
```

---

## Node Types

```typescript
type KnowledgeNodeType =
  | 'skill'           // SKILL.md entry
  | 'rfc'             // RFC document
  | 'implementation'  // IMPLEMENTATION/* entry
  | 'concept'         // Abstract concept
  | 'api'             // API endpoint
  | 'cli'             // CLI command
  | 'pattern'         // Code pattern
  | 'workflow';       // Workflow/SOP

interface KnowledgeNode {
  id: string;           // e.g., "skill:frappe-custom-field-lifecycle"
  type: KnowledgeNodeType;
  data: {
    title: string;
    description?: string;
    tags: string[];
    source?: string;     // File path
    url?: string;        // RFC/IMPLEMENTATION URL
  };
}
```

---

## Edge Types

```typescript
type KnowledgeEdgeType =
  | 'implements'       // Skill implements RFC
  | 'depends_on'       // Skill A depends on Skill B
  | 'supersedes'       // New version replaces old
  | 'related_to'      // General relationship
  | 'authored_by'     // Author attribution
  | 'documents'        // RFC/Impl documents a skill
  | 'references';      // RFC references implementation

interface KnowledgeEdge {
  from: string;          // Node ID
  to: string;           // Node ID
  type: KnowledgeEdgeType;
  metadata?: {
    confidence?: number;  // 0-1
    source?: string;      // How was this edge discovered
  };
}
```

---

## Provenance Mapping

```
RFC-0105 (Distributed Knowledge Retrieval)
        ↓ implements
IMPLEMENTATION/RFC-0105/
        ↓ contains
packages/tencentdb-memory/
        ↓ indexes
moocoding-skills/skills/tencentdb-sync/SKILL.md

Knowledge Graph:
  skill:tencentdb-sync --implements--> rfc:RFC-0105
  skill:tencentdb-sync --documents--> implementation:RFC-0105
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
  implements: RFC-0052
  related_implementation: IMPLEMENTATION/RFC-0052
  author: moocoding
---

# Frappe Custom Field Lifecycle

## When to Use
...

## Procedure
...

## Pitfalls
...

## Related Skills
- [[skill:frappe-doctype-field-order]]
- [[skill:property-setter-pattern]]
```

---

## Extraction Pipeline

```typescript
// Extract knowledge from SKILL.md files → Knowledge Graph
async function extractKnowledgeGraph(sourcePath: string, config: TencentDBConfig) {
  // 1. Parse all SKILL.md files
  const docs = indexDirectory(sourcePath);
  
  // 2. Create nodes and edges
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  
  for (const doc of docs) {
    // Create skill node
    nodes.push({
      id: `skill:${doc.id}`,
      type: 'skill',
      data: {
        title: doc.title,
        description: doc.sections[0]?.content.slice(0, 200),
        tags: doc.metadata.tags,
        source: doc.metadata.source,
      }
    });
    
    // Extract provenance from frontmatter
    const provenance = doc.metadata.provenance;
    if (provenance.implements) {
      edges.push({
        from: `skill:${doc.id}`,
        to: `rfc:${provenance.implements}`,
        type: 'implements'
      });
    }
    if (provenance.related_implementation) {
      edges.push({
        from: `skill:${doc.id}`,
        to: `implementation:${provenance.related_implementation}`,
        type: 'documents'
      });
    }
    
    // Link to RFCs found in content
    const rfcRefs = extractRFCRefs(doc.content);
    for (const rfc of rfcRefs) {
      edges.push({
        from: `skill:${doc.id}`,
        to: `rfc:${rfc}`,
        type: 'references'
      });
    }
    
    // Wiki links become edges
    for (const link of doc.links) {
      if (link.startsWith('skill:')) {
        edges.push({
          from: `skill:${doc.id}`,
          to: link,
          type: 'related_to'
        });
      }
    }
  }
  
  // 3. Sync to Knowledge Service
  await syncGraph({
    nodes,
    edges,
    config
  });
}

// Sync to Knowledge Service (8424)
async function syncGraph(payload: { nodes: KnowledgeNode[], edges: KnowledgeEdge[] }, config: TencentDBConfig) {
  const response = await fetch(`${config.knowledgeUrl}/v3/knowledge/graph/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tdai-user-key': config.userKey,
      'x-tdai-service-id': config.serviceId,
    },
    body: JSON.stringify(payload)
  });
  return response.json();
}
```

---

## MCP Integration (RFC-0106)

```typescript
interface KnowledgeGraphMCP {
  // Search skills via Knowledge Service
  kg_search(query: string): Promise<SearchResult[]>;
  
  // Query graph relationships
  kg_query(type: string, from?: string, to?: string): Promise<Edge[]>;
  
  // Get node details
  kg_node(id: string): Promise<KnowledgeNode>;
  
  // Get skill by RFC
  kg_findByRFC(rfcId: string): Promise<KnowledgeNode[]>;
  
  // Get related skills
  kg_related(skillId: string): Promise<KnowledgeNode[]>;
}
```

---

## File Structure

```
packages/tencentdb-memory/
├── src/
│   ├── client.ts          # Memory Core client (8420)
│   ├── knowledge.ts        # Knowledge Service client (8424)
│   ├── proxy.ts           # Proxy client (8096)
│   ├── loader.ts         # SKILL.md loader
│   ├── indexer.ts        # OKF indexer (from okf-indexer package)
│   └── sync.ts           # Graph sync pipeline
└── package.json

packages/okf-indexer/
├── src/
│   ├── indexer.ts        # Parse SKILL.md → OKF
│   ├── extractor.ts      # Extract provenance/edges
│   └── cli.ts           # CLI for indexing
└── package.json

scripts/
└── tencentdb-sync.ts    # Sync CLI
```

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| TencentDB-Agent-Memory | Knowledge Service (8424) |
| okf-indexer | SKILL.md → OKF parsing |
| chokidar | File watching for auto-sync |

---

## Files

See `IMPLEMENTATION/RFC-0106/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0106/ACCEPTANCE_CRITERIA.md`.

# RFC-0106 Files

## Source Files

```
packages/
  knowledge-graph/
    src/
      index.ts              # Main exports
      okf-parser.ts         # Parse SKILL.md to OKF
      graph-extractor.ts    # Extract nodes and edges
      provenance-linker.ts  # Link RFC/IMPLEMENTATION
      mcp-client.ts         # Graph MCP tools
      types.ts             # Shared types
```

## Configuration

```
configs/
  knowledge-graph/
    graph.json             # Graph settings
    extraction.json       # Extraction rules
    provenance.json       # Provenance mapping
```

## Scripts

```
scripts/
  extract-knowledge-graph.ts  # Build graph from skills
  migrate-neo4j.ts           # Future: Neo4j migration
```

## Documentation

```
docs/
  knowledge-graph/
    README.md
    GRAPH_SCHEMA.md
    PROVENANCE.md
```

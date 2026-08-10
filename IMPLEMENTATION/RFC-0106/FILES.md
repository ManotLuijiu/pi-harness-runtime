# RFC-0106 Files

## Source Files

```
packages/
  knowledge-graph/
    src/
      index.ts              # Main exports
      types.ts             # Type definitions
      graph-extractor.ts   # Extract nodes/edges from SKILL.md
      provenance-linker.ts # Provenance and inference
      mcp-client.ts       # Knowledge Service MCP client
    package.json
    tsconfig.json
```

## Dependencies

| Package | Purpose |
|---------|---------|
| @pi-harness/okf-indexer | SKILL.md parsing |

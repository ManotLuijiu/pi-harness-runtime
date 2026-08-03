# RFC-0105 Files

## Source Files

```
packages/
  knowledge-retrieval/
    src/
      index.ts              # Main exports
      mcp-client.ts        # MCP client for TencentDB
      sync.ts              # Skills sync pipeline
      types.ts             # Shared types
```

## Configuration

```
configs/
  knowledge-retrieval/
    server.json            # TencentDB server URL
    sync.json             # Sync schedule
    embeddings.json       # Embedding config
```

## Scripts

```
scripts/
  sync-skills.ts          # Sync skills to server
  deploy-memory.sh        # Deploy server
```

## Documentation

```
docs/
  knowledge-retrieval/
    README.md
    SERVER_SETUP.md
    MCP_INTEGRATION.md
```

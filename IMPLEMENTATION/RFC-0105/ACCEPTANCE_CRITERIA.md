# RFC-0105 Acceptance Criteria

## Functional Requirements

- [ ] TencentDB-Agent-Memory server deployed and accessible
- [ ] Skills sync from moocoding-skills to server
- [ ] MCP tools available: tdai_memory_search
- [ ] Hybrid search (BM25 + vector + RRF) working
- [ ] OKF format for skill documents
- [ ] Periodic sync configured

## Non-Functional Requirements

- [ ] Search latency < 200ms
- [ ] Sync completes in < 5 minutes for full skills folder
- [ ] Graceful handling of server unavailable

## Integration Tests

- [ ] Agent queries skills via MCP
- [ ] Skills appear in search results
- [ ] Sync detects new/updated/deleted skills
- [ ] Ranked results with scores

## Documentation

- [ ] Server setup guide
- [ ] MCP tool reference
- [ ] Sync configuration

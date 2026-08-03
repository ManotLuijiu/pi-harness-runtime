# RFC-0105 — Distributed Knowledge Retrieval

> **Status:** proposed
> **Author:** pi-harness-runtime
> **Replaces:** N/A
> **Superseded by:** N/A
> **Depends on:** N/A

---

## Summary

Deploy TencentDB-Agent-Memory server for centralized knowledge retrieval with hybrid search (BM25 + vector + RRF fusion), replacing per-project `moocoding-skills` folder with a single server accessible via MCP. Support multi-server topology: **Source Server** (owns skills) and **Consumer Servers** (read-only access via Proxy).

---

## Motivation

**Current state:**

```
machine-A/frappe-bench/.claude-plugins/moocoding-skills/skills/...
machine-B/frappe-bench/.claude-plugins/moocoding-skills/skills/...
machine-C/frappe-bench/.claude-plugins/moocoding-skills/skills/...
```

**Problems:**

- Skills duplicated across machines
- No unified search
- Manual sync required per machine
- Source of truth unclear

**Solution:**

```
Source Server (MooCoding's server)
  - Owns: frappe-bench/.claude-plugins/moocoding-skills/skills/*
  - Services: Memory Core (8420), Knowledge (8424), Panel UI (8125), Proxy (8096)
  - Owner syncs skills here via okf-indexer
  
Consumer Servers (all other users)
  - No local skills folder needed
  - Connect to Source Server's Proxy (8096)
  - pi-harness-runtime queries via MCP → Proxy → Knowledge service
```

---

## Server Architecture (TencentDB-Agent-Memory)

| Service | Port | Purpose |
|---------|------|---------|
| Memory Core | 8420 | Memory read/write, auth, skill/RAG data plane |
| Panel UI | 8125 | Team memory control panel |
| Knowledge | 8424 | Wiki / code-graph service |
| Proxy | 8096 | LLM request proxy (Anthropic/OpenAI dual-protocol) |

---

## Multi-Server Topology

```
┌─────────────────────────────────────────────────────────┐
│  SOURCE SERVER (e.g., https://your-memory-server.example.com)           │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Memory Core │  │  Knowledge   │  │    Proxy    │  │
│  │   (8420)    │  │   (8424)    │  │   (8096)    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│         ▲               ▲               ▲              │
│         │               │               │              │
│  Skills sync via   Wiki/Skills    LLM API          │
│  okf-indexer       storage         gateway          │
│                                                         │
│  Owner: MooCoding                                      │
│  Source: frappe-bench/.claude-plugins/moocoding-skills/│
└─────────────────────────────────────────────────────────┘
           │                              ▲
           │ MCP Query                    │ LLM Proxy
           ▼                              │
┌─────────────────────────────────────────────────────────┐
│  CONSUMER SERVER (e.g., user's laptop)                 │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │Memory Core  │  │  Knowledge  │  │   Proxy     │  │
│  │  (optional) │  │ (optional)  │  │  (optional) │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                         │
│  pi-harness-runtime ──MCP──→ Source Server's Proxy    │
│                                                         │
│  Consumer: Any user                                     │
│  No local skills folder needed                          │
└─────────────────────────────────────────────────────────┘
```

---

## Configuration Schema

```typescript
interface TencentDBConfig {
  /** Source Server (owns skills) */
  sourceServer: {
    url: string;           // e.g., "https://https://your-memory-server.example.com"
    userKey: string;       // Business user's sk-mem-xxx
  };
  
  /** Local Server (optional, for self-hosted consumers) */
  localServer?: {
    memoryCore: string;    // http://localhost:8420
    knowledge: string;     // http://localhost:8424
    proxy: string;        // http://localhost:8096
  };
  
  /** Skills Source (for sync on Source Server) */
  skillsSource?: {
    path: string;          // e.g., "~/frappe-bench/.claude-plugins/moocoding-skills/skills"
    watch?: boolean;       // Auto-sync on file changes
  };
  
  /** Sync settings */
  sync?: {
    autoSync: boolean;     // Sync on startup
    interval?: number;     // Minutes between syncs (default: 60)
  };
}
```

---

## Configuration Locations

| Priority | Location | Example |
|----------|----------|---------|
| 1 | CLI flag | `--tencentdb-url https://memory.example.com` |
| 2 | Env var | `TENANTDB_URL`, `TENANTDB_USER_KEY` |
| 3 | Config file | `.pi/settings.json` → `tencentdb` |
| 4 | Interactive prompt | User prompted on first use |

---

## API Endpoints

### Memory Core (8420)

```bash
# Auth
POST /v3/meta/auth/verify

# User management
POST /v3/meta/user/create
GET  /v3/meta/user/list

# Team/Agent/Task
POST /v3/meta/team/create
GET  /v3/meta/team/list
POST /v3/meta/agent/create
GET  /v3/meta/agent/list
```

### Knowledge Service (8424)

```bash
# Wiki/Skills
POST /v3/wiki/documents
GET  /v3/wiki/documents?team_id=xxx
GET  /v3/wiki/documents/{id}
DELETE /v3/wiki/documents/{id}

# Search
POST /v3/wiki/search
POST /v3/knowledge/graph/search

# Skills
POST /v3/skills/sync
GET  /v3/skills/list
GET  /v3/skills/{name}
```

### Proxy (8096)

```bash
# LLM Gateway
POST /claude-code/{serviceId}/v1/messages
POST /claude-code/{serviceId}/v1/chat/completions
```

---

## Sync Strategy (okf-indexer → Source Server)

```bash
# 1. Owner configures Source Server
TENANTDB_URL=https://https://your-memory-server.example.com
TENANTDB_USER_KEY=sk-mem-xxx

# 2. Sync skills from local source
okf-sync --source ~/frappe-bench/.claude-plugins/moocoding-skills/skills

# 3. Knowledge service indexes SKILL.md → OKF Wiki
POST /v3/wiki/documents
{
  "title": "Frappe Custom Field Lifecycle",
  "content": "# Frappe Custom Field Lifecycle\n\n## When to Use\n...",
  "tags": ["frappe", "custom-field"],
  "team_id": "moocoding"
}

# 4. CodeGraph indexes relationships
POST /v3/knowledge/graph/sync
{
  "nodes": [...],
  "edges": [...]
}
```

---

## Consumer Access (MCP)

```typescript
// pi-harness-runtime connects via MCP to Source Server's Knowledge service
const config = {
  sourceServer: {
    url: "https://https://your-memory-server.example.com",
    userKey: process.env.TENANTDB_USER_KEY,
  }
};

// MCP tools exposed:
interface TDAMCTools {
  // Search skills
  tdai_memory_search(query: string): Promise<SearchResult[]>;
  
  // Code graph
  tdai_codegraph_query(symbol: string): Promise<GraphResult>;
  
  // List skills
  tdai_list_skills(): Promise<SkillInfo[]>;
  
  // Health check
  tdai_health(): Promise<HealthStatus>;
}
```

---

## CLI Commands

```bash
# Setup (interactive)
/tencentdb setup

# Sync skills to Source Server
/tencentdb sync

# Watch mode (auto-sync on changes)
/tencentdb sync --watch

# Search skills
/tencentdb search "typescript errors"

# Status
/tencentdb status

# Connect to Source Server (consumer mode)
/tencentdb connect --url https://https://your-memory-server.example.com --key sk-mem-xxx
```

---

## Environment Variables

```bash
# Source Server (required for consumer)
TENANTDB_URL=https://https://your-memory-server.example.com
TENANTDB_USER_KEY=sk-mem-xxx

# Local Server (for self-hosted, optional)
TENANTDB_MEMORY_CORE=http://localhost:8420
TENANTDB_KNOWLEDGE=http://localhost:8424
TENANTDB_PROXY=http://localhost:8096

# Sync settings
TENANTDB_SKILLS_SOURCE=~/frappe-bench/.claude-plugins/moocoding-skills/skills
TENANTDB_AUTO_SYNC=true
TENANTDB_SYNC_INTERVAL=60
```

---

## Files

See `IMPLEMENTATION/RFC-0105/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0105/ACCEPTANCE_CRITERIA.md`.

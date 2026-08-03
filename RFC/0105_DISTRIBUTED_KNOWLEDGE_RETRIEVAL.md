# RFC-0105 — Distributed Knowledge Retrieval

> **Status:** proposed
> **Author:** pi-harness-runtime
> **Replaces:** N/A
> **Superseded by:** N/A
> **Depends on:** N/A

---

## Summary

Deploy TencentDB-Agent-Memory server for centralized knowledge retrieval with hybrid search (BM25 + vector + RRF fusion), replacing per-project `moocoding-skills` folder with a single server accessible via MCP.

---

## Motivation

**Current state:**

```
project-A/.claude-plugins/moocoding-skills/skills/...
project-B/.claude-plugins/moocoding-skills/skills/...
project-C/.claude-plugins/moocoding-skills/skills/...
```

**Problems:**

- Skills duplicated across projects
- No unified search
- Manual sync required
- Storage waste

**Solution:**

```
TencentDB-Agent-Memory Server (single source of truth)
        ↓
All skills indexed once
        ↓
MCP Tools: tdai_memory_search, tdai_codegraph_query
        ↓
All projects access via API
```

---

## Architecture

```
+-------------------+
| Skills Source      |
| moocoding-skills/ |
+-------------------+
        ↓ sync
+------------------------+
| TencentDB-Agent-Memory |
| Server                 |
| - Wiki (OKF format)   |
| - CodeGraph           |
| - sqlite-vec          |
| - Hybrid retrieval    |
+------------------------+
        ↓ MCP/HTTP
+-------------------+
| pi-harness-runtime |
| (all projects)     |
+-------------------+
```

---

## Server Specification

| Component | Spec | Notes |
|-----------|------|-------|
| **CPU** | 2 vCPU | Lightweight API |
| **RAM** | 4 GB | SQLite buffers |
| **Storage** | 50 GB SSD | Grows with KB |
| **OS** | Ubuntu 22.04 | Docker |
| **Embedding** | OpenAI API | or BGE-M3 |

**Recommended:** $10-20/month VPS (Hetzner, DigitalOcean) or self-host.

---

## Docker Compose

```yaml
services:
  tdai-memory:
    image: ghcr.io/tencentcloud/tdai-memory:latest
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - STORE_BACKEND=sqlite
      - RECALL_STRATEGY=hybrid
```

---

## MCP Integration

```typescript
// MCP server connecting to TencentDB-Agent-Memory
interface MemoryMCP {
  // Search skills
  tdai_memory_search(query: string): Promise<SkillResult[]>;

  // Code graph queries
  tdai_codegraph_query(symbol: string): Promise<CodeGraphResult>;

  // Sync skills from source
  tdai_sync_skills(sourcePath: string): Promise<SyncResult>;
}

interface SkillResult {
  id: string;
  title: string;
  content: string;
  score: number;
  path: string;  // Original SKILL.md path
}
```

---

## OKF (Open Knowledge Format)

Skills stored as OKF wiki pages:

```typescript
interface OKFDocument {
  id: string;
  title: string;
  sections: OKFSection[];
  links: string[];  // Links to other OKF docs
  metadata: {
    source: string;  // Original SKILL.md path
    tags: string[];
    created: string;
    updated: string;
  };
}

interface OKFSection {
  id: string;
  title: string;
  content: string;
  level: number;  // h1-h6
}
```

---

## Sync Strategy

```typescript
// Periodic sync from moocoding-skills to server
async function syncSkills() {
  const skillsDir = 'frappe-bench/.claude-plugins/moocoding-skills/skills/';

  for (const skillPath of glob(skillsDir + '*/SKILL.md')) {
    const skill = parseSKILL(skillPath);
    const okf = convertToOKF(skill);
    await tdaiClient.ingest(okf);
  }
}
```

---

## Retrieval Flow

```
Agent: "I need to fix TypeScript errors"
        ↓
tdai_memory_search("typescript errors")
        ↓
TencentDB-Agent-Memory (hybrid: BM25 + vec + RRF)
        ↓
Returns ranked skills with scores
        ↓
Agent reads relevant SKILL.md sections
        ↓
Executes task with retrieved knowledge
```

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| TencentDB-Agent-Memory | Server software |
| OpenAI API | Embeddings |
| MCP | Protocol to pi-harness-runtime |

---

## Files

See `IMPLEMENTATION/RFC-0105/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0105/ACCEPTANCE_CRITERIA.md`.

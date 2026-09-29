# Hermes-Style Skill System

## Overview

This document describes the Hermes Agent-inspired self-improving skill system for pi-harness-runtime. Unlike traditional hardcoded skills, this system allows the agent to **autonomously create, update, and refine skills** based on learned patterns.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   USER'S HOME DIRECTORY                          │
│                   (~/.pi-harness-runtime/)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│    skills/    │    │    memory/   │    │    logs/      │
│               │    │               │    │               │
│ Agent writes  │    │ MEMORY.md    │    │ learning-     │
│ new skills    │    │ USER.md      │    │ journey.json  │
│ here          │    │              │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │         pi.dev discovers      │
              │         skills automatically   │
              │         from ~.pi/skills/     │
              └───────────────────────────────┘
```

## Directory Structure

```
~/.pi-harness-runtime/
├── skills/                          # Agent's skill directory
│   ├── frappe-app-build-system/      # User-provided or agent-created
│   │   └── SKILL.md
│   ├── erpnext-manufacturing/       # User-provided or agent-created
│   │   └── SKILL.md
│   └── [agent-created]/             # Skills agent writes autonomously
│       └── SKILL.md
├── memory/                           # Persistent memory
│   ├── MEMORY.md                    # Learned patterns, best practices
│   └── USER.md                      # User preferences, context
├── trajectory/                       # Learning analytics
│   ├── review-fork.json
│   ├── learning-graph.json
│   └── staged-writes/
└── logs/
    └── session-logs/
```

## Skill Format (Hermes + pi.dev Hybrid)

Skills combine pi.dev compatibility with Hermes self-improvement metadata:

```yaml
---
# pi.dev standard fields
name: skill-name
description: What this skill does. Use when [trigger conditions].

# Hermes extension fields (for self-improvement)
author: agent | user | curator
version: 1.0.0
confidence: 0.85                    # Agent's confidence in this skill
triggers:
  - trigger-word-1
  - trigger-word-2
pitfalls:
  - name: common-mistake
    why: Explain why this is problematic
examples:
  - input: Example user request
    output: How agent should respond
---

# Skill Name

## Overview
[What this skill covers]

## When to Use
[Detailed trigger conditions]

## Procedure
[Step-by-step instructions]

## Gotchas
[Common pitfalls to avoid]
```

## Skill Lifecycle

### 1. Creation (Agent Autonomous)

```typescript
// Agent uses skill_manage tool to create skill
await skill_manage({
  action: "create",
  name: "new-pattern-learned",
  description: "Handle X pattern. Use when...",
  body: "# New Pattern\n\n[Learned procedure...]"
});
```

### 2. Discovery (pi.dev Automatic)

```
~/.pi-harness-runtime/skills/
     ↓
pi.dev scans at startup
     ↓
Skills available via /skill:name
```

### 3. Versioning (Automatic)

```typescript
// Every skill update creates a version
const versioning = getSkillVersioning();
versioning.recordVersion(
  "skill-name",
  newContent,
  "agent",
  "Learned from error pattern X"
);
```

### 4. Rollback (Agent Can Request)

```typescript
// If skill causes issues, rollback
versioning.rollback("skill-name", "1.0.0");
```

## Self-Improvement Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     WORK SESSION                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Background      │
                    │  Review Fork     │
                    │  (analyzes past) │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │    Curator      │
                    │ (extracts       │
                    │  patterns)       │
                    └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
      │ New skill   │ │ Update      │ │ Memory      │
      │ created     │ │ existing    │ │ updated     │
      └─────────────┘ └─────────────┘ └─────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────────────┐
                    │ Write Approval  │
                    │ Gate (optional) │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Skill written   │
                    │ to disk         │
                    └─────────────────┘
```

## Write Approval Gate

For safety, skill writes can require approval:

```typescript
// Before writing skill
const gate = getWriteApprovalGate();

// Check if approval needed
if (gate.requiresApproval("skill_create", "agent")) {
  // Stage the write
  const staged = gate.stage({
    type: "skill_create",
    target: "new-skill",
    content: skillContent
  });
  
  if (staged.staged) {
    return "Skill staged for approval. Use /approve to apply.";
  }
}
```

## User-Provided Skills vs Agent-Created Skills

### User-Provided Skills
- Located in: `~/.pi-harness-runtime/skills/`
- User controls: add, remove, update
- Agent can read and improve

### Agent-Created Skills
- Same location: `~/.pi-harness-runtime/skills/`
- Author field: `agent`
- Agent controls: create, update
- User can review and override

## Sensitive Data Handling

**Important:** The `~/.pi-harness-runtime/` directory is user-controlled, NOT in the codebase.

### Best Practices

1. **Don't hardcode skills in pi-harness-runtime**
   - Skills belong in user's home directory
   - Users choose their own skill sources

2. **Sync script for user convenience**
   ```bash
   # User runs to sync from their skill source
   bun scripts/sync-skills.ts --from ~/my-skills
   ```

3. **Backup recommendations**
   - `~/.pi-harness-runtime/` should be backed up
   - Contains agent learning + user skills + memory

## Qdrant Integration (Team Sharing)

Skills can be stored in Qdrant vector database for team sharing across multiple PCs.

### Setup

1. **Get Qdrant API Key**
   ```bash
   # Option 1: Environment variable
   export QDRANT_API_KEY=your-api-key

   # Option 2: File (preferred - same pattern as Jev)
   echo "your-api-key" > ~/.pi-harness-runtime/keys/qdrant-api-key.txt
   ```

2. **Sync Skills to Qdrant**
   ```bash
   # Upload all local skills to Qdrant
   bun scripts/sync-to-qdrant.ts --from ~/.pi-harness-runtime/skills

   # Clear and re-upload
   bun scripts/sync-to-qdrant.ts --from ~/.pi-harness-runtime/skills --clear
   ```

3. **Use Skills from Qdrant**
   ```bash
   # Search skills
   bun scripts/sync-to-qdrant.ts --search "frappe permissions"

   # List skills in Qdrant
   bun scripts/sync-to-qdrant.ts --list
   ```

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    QDRANT CLOUD                             │
│                                                              │
│  Skills embedded with OpenAI (text-embedding-3-small)        │
│  Semantic search finds related skills by meaning            │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ frappe-     │  │ erpnext-    │  │ frappe-     │         │
│  │ permission  │  │ manufacturing│  │ custom-    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
         ↑                    ↑                    ↑
    PC-A (home)          PC-B (office)        PC-C (travel)
```

### Benefits

| Scenario | Without Qdrant | With Qdrant |
|----------|---------------|-------------|
| Setup new PC | Sync 124 skills manually | Just add Qdrant API key |
| Find skill | Keyword match only | Semantic understanding |
| Team sharing | Manual file sharing | Qdrant team workspace |

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SKILL SEARCH FLOW                         │
└─────────────────────────────────────────────────────────────┘

  USER REQUEST
       │
       ▼
  ┌─────────────────┐
  │ Local Skills    │  ← First: Check ~/.pi-harness-runtime/skills/
  │ (Hermes/pi.dev)│     Uses triggers, confidence, author
  └────────┬────────┘
           │ (if not found)
           ▼
  ┌─────────────────┐
  │ Qdrant Search   │  ← Fallback: Semantic search in Qdrant
  │ (Team Skills)   │     Uses OpenAI embeddings
  └────────┬────────┘
           │ (if not found)
           ▼
  ┌─────────────────┐
  │ Agent Creates   │  ← Last resort: Agent creates new skill
  │ New Skill       │     And optionally uploads to Qdrant
  └─────────────────┘
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_API_KEY` | - | Qdrant Cloud API key |
| `QDRANT_URL` | `https://api.qdrant.tech` | Qdrant server URL |
| `QDRANT_COLLECTION` | `pi-harness-skills` | Collection name |

## Integration with pi.dev

### pi.dev Skill Discovery Locations

pi.dev automatically discovers skills from:
| Location | Notes |
|----------|-------|
| `~/.pi/skills/` | User-level |
| `~/.pi-harness-runtime/skills/` | Our skills directory |
| `.agents/skills/` | Project-level |
| `.pi/skills/` | Project-level |

### Making pi.dev Discover Our Skills

```typescript
// In pi-harness-runtime, we can:
// 1. Create symlink (optional)
if (!existsSync("~/.pi/skills")) {
  symlinkSync("~/.pi-harness-runtime/skills", "~/.pi/skills");
}

// 2. Or document for users
// Add ~/.pi-harness-runtime/skills to ~/.pi/skills/ manually
```

## Commands for Users

### /skill commands (pi.dev built-in)
```bash
/skill:list           # List all available skills
/skill:search <query> # Find skills matching query
/skill:info <name>    # Show skill details
```

### pi-harness-runtime skill management
```bash
# Via agent tool (agent can also do this)
skill_manage(action: "create", name: "...", body: "...")
skill_manage(action: "lint", name: "...")
```

## Related Documents

- [Hermes Self-Improvement Adaptation](./hermes-self-improvement-adaptation.md)
- [pi.dev Skills Documentation](https://pi.dev/docs/latest/skills)
- [Anthropic Skills Collection](https://github.com/anthropics/skills)

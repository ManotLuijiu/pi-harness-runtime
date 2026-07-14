# Multi-Day Action Plan: 100 RFCs to Production

Based on review of all 100 RFCs (0001–0100) and IMPLEMENTATION/* entries.

---

## ✅ Day 1 — Already Done

- **RFC-0052 Skill Registry** — capability registry integration, `invokeBestMatch`, capability checking, extended defaults, 13 new tests (31/31 passing)
- **RFC-0060 Memory Engine** — `validateConcept`, `writeConcept`, `search`, `promoteFromBlackboard`, `extractLinks`, `exportToOkf` (18/18 passing)
- **40 new RFCs** (0061–0100) committed with stub IMPLEMENTATION directories

---

## 📋 Remaining Work (by priority)

### 🔴 High Priority — Foundation Dependencies

These packages block multiple others. Must implement first.

| Package | RFC | Blocks | Key Tasks |
|---------|-----|--------|-----------|
| `framework-detector` | 0038 | 0040, 0061–0066 | Auto-detect project framework from files, env, deps |
| `framework-plugin-sdk` | 0040 | 0061–0066 | SDK for writing framework plugins, manifest schema, plugin API |
| `model-registry` | 0053 | 0054, cost-optimizer | `models.list()` pagination, alias vs snapshot, price table |
| `capability-registry` | 0051 | 0052 (done), 0091–0096 | Capability definitions, provider support matrix |

### 🟡 Medium Priority — Core Systems

Implement these in parallel after foundation.

| Package | RFC | Key Tasks |
|---------|-----|-----------|
| `code-generation` | 0037 | Scaffold generation, template engine, multi-framework support |
| `code-review` | 0036 | AST analysis, rule engine, lint integration, multi-LLM review |
| `evaluation-engine` | 0057 | Test runner, pass/fail criteria, benchmark suite |
| `learning-engine` | 0058 | Pattern extraction, weight updates, learning from outcomes |
| `experience-replay` | 0059 | Experience storage, retrieval, replay for similar tasks |
| `performance-optimizer` | 0056 | Token estimation, context window management, cache |
| `task-compiler` | 0044 | Task graph executor, dependency resolution, parallel execution |

### 🟢 Lower Priority — Autonomous Features (RFC 0091–0100)

These depend on core systems above. Implement after core is stable.

| Package | RFC | Description |
|---------|-----|-------------|
| `autonomous-architecture-review` | 0091 | AI reviews PRs against architecture rules |
| `autonomous-refactoring` | 0092 | Auto-suggest/apply refactors |
| `autonomous-bug-fixing` | 0093 | Auto-fix from bug reports + test failures |
| `autonomous-performance-tuning` | 0094 | Profile + suggest optimizations |
| `autonomous-security-review` | 0095 | Scan for security issues |
| `autonomous-cost-optimization` | 0096 | Suggest/reduce API costs |
| `autonomous-documentation` | 0097 | Auto-generate/update docs |
| `autonomous-knowledge-management` | 0098 | Maintain knowledge graph |
| `runtime-evolution-engine` | 0099 | Self-improve from outcomes |
| `self-developing-runtime` | 0100 | Closed loop: build → test → learn → improve |

---

## 📅 Suggested Day Breakdown

### Day 2: Framework Foundation
1. `framework-detector` — detect Frappe, Next.js, React/Vite, Django, Laravel
2. `framework-plugin-sdk` — plugin manifest schema, lifecycle hooks, TypeScript SDK
3. Verify: `npm run build` passes, tests green

### Day 3: Model + Capability Foundation
1. `capability-registry` — capability definitions, provider matrix
2. `model-registry` — paginated `models.list()`, alias/snapshot separation, pricing
3. `cost-optimizer` — spend tracking, routing by cost/speed/length

### Day 4: Code Intelligence
1. `code-generation` — scaffold templates, multi-framework support
2. `code-review` — AST parsing, rule engine, GitHub integration
3. `evaluation-engine` — benchmark harness, pass/fail criteria

### Day 5–7: Learning + Experience
1. `learning-engine` — pattern extraction, weight updates
2. `experience-replay` — storage, similarity search, retrieval
3. `task-compiler` — parallel task execution, dependency graph

### Day 8+: Autonomous Features
- Implement RFC 0091–0100 one by one, each with tests + integration
- Start with 0091 (architecture review) as it's most immediately useful

---

## ⚠️ Key Conventions

- All packages: `src/` + `test/` + `dist/`, TypeScript, `bun test`
- Export types from `src/index.ts`
- Build before commit: `bun run build && bun test`
- Dist files (generated): commit after build
- RFC stubs (0061–0100): add actual AI brief content before implementing

---

## 📁 IMPLEMENTATION Structure Per RFC

Each IMPLEMENTATION/*/ has 5 files:
- **TASKS.md** — numbered implementation checklist
- **ACCEPTANCE_CRITERIA.md** — done conditions
- **FILES.md** — expected source file layout
- **AI_BRIEF.md** — detailed AI instruction for implementation
- **TESTS.md** — test scenarios

Fill in AI_BRIEF.md before starting implementation.

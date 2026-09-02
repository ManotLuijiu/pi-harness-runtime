# pi-harness-runtime Roadmap

## Version History

| Tag | Date | Milestone |
|-----|------|-----------|
| v1.0.0 | — | Initial release |
| v1.1.39–v1.1.49 | — | LoopWidget, PING-PONG scoreboard, autonomy signals, coder tools, cron source, status line |
| **v1.1.50** | — | **M6: Smart-stop convergence** |

---

## Milestones

### M1 — Basic loop (done pre-v1.1)
- LangGraph write-review loop (`buildWriteReviewLoop`)
- Real model wiring (`buildRealLoopDeps`)
- Dry-run deps (`buildDryRunDeps`)
- **Status:** shipped

### M2 — Daemon integration (done v1.1.39+)
- `LoopDaemon` class
- Inbox file-drop trigger
- Bus task.proposed trigger
- Lease manager single-writer
- Approval gate (never/always/manual)
- Crash resilience via MemorySaver checkpointer
- **Status:** shipped

### M3 — Surge auto-resume (done v1.1.46)
- `SurgeScheduler` with exponential backoff (3→6→12→24→48 min)
- `invokeWithSurgeRetry` wrapper
- `surgePolicy` config in daemon
- **Status:** shipped

### M4 — Tailscale tunnel automation (done v1.1.47)
- `amos-saas/scripts/tailscale-tunnel.sh`
- `start/check/stop/restart` subcommands
- Auth URL detection + browser auto-open
- `pg_isready` confirmation
- **Status:** shipped

### M5 — UI + observability (done v1.1.49)
- `LoopWidget` — progress TUI with phase/iteration/file tracking
- `WriteReviewBlackboard` — PING-PONG scoreboard, injected into agent prompts
- `StatusLineManager` — pi-lens integration + `.harness-status` fallback
- `CronWatcher` — `.cron-tasks/` file-based scheduling
- Coder file tools (`read_file`, `write_file`, `list_directory`)
- ASCII-only output (no emoji)
- **Status:** shipped

### M6 — Smart-stop convergence (done v1.1.50)
- `hasOnlyMinor` check in `routeAfterReview` — converges fast on nitpick comments
- `lastCommentedFile` in `LoopState` — tracks file-level comment history
- Dry-run reviewer severity bumped to `major` (was triggering smart-stop prematurely)
- Constructor `deps` propagation fixed (was silently dropped)
- **Status:** shipped

### M7 — Trajectory capture + learning (in progress)
> Inspired by Hermes Agent's closed learning loop. Our loop produces structured
> write-review cycles — persist them to build a smarter loop over time.

| # | Feature | Status |
|---|---------|--------|
| 7a | Trajectory capture — save cycles to `~/.pi-harness/trajectories/` | **Done (v1.1.51)** |
| 7b | Review memory — track approved patterns in `~/.pi-harness/approved-patterns.json` | Pending |
| 7c | Trajectory classifier — detect converging vs. diverging cycles | Pending |

**Design:** `packages/trajectory/src/` — new package, keeps concerns separated.

**Data shape:**
```ts
interface Trajectory {
  id: string;
  taskRequest: string;
  createdAt: string;        // ISO
  durationMs: number;
  iterations: number;
  verdict: "approved" | "blocked" | "changes_requested";
  reason: string;           // "converged", "max iterations", "stuck"
  plan: string;
  code: string;             // final code output
  review: ReviewVerdict;     // final review
  files: string[];          // files mentioned
  comments: Comment[];       // all comments across iterations
}
```

**Benefits:**
- Cluster trajectories by verdict/reason → learn which patterns converge
- Detect diverging cycles early → auto-terminate before burning iterations
- Audit trail for post-mortems

### M8 — Cron CLI + pi-lens extension (pending)
| # | Feature | Status |
|---|---------|--------|
| 8a | `bd cron add <schedule> <request>` — create cron task | Pending |
| 8b | `bd cron list` — list scheduled tasks | Pending |
| 8c | `bd cron rm <id>` — remove task | Pending |
| 8d | pi-lens extension: wire `LoopWidget.makeRenderer()` into `ExtensionUIContext.setWidget()` | Pending |

---

## Deferred / Backlog

| Item | Priority | Notes |
|------|----------|-------|
| Skill library for reviewer patterns | Low | Premature for v1; complex |
| Honcho user modeling | None | No user-facing interaction in daemon mode |
| Weight/fine-tuning integration | None | Base model weights unchanged |

---

## Architecture Principles

1. **Human on the loop, not in it** — auto-trigger, direct agent routing, notification at gates
2. **Structured data everywhere** — trajectories, scoreboard, approved patterns are queryable artifacts
3. **ASCII by default** — bundle size; Lucide SVG if polished; no emoji
4. **Error by code, not model name** — `/Usage limit.*reset/i` for 5h exhaustion
5. **Externalized memory + retrieval** — persistent artifacts make each iteration smarter (no weight updates)

# T3Code Analysis: Can We Learn From It?

## Executive Summary

**T3Code** is a production-ready "agent harness control surface" with 28K+ stars. It controls Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity through mobile, web, and desktop apps.

**pi-harness-runtime** has 80+ packages but is a fragmented codebase lacking the unified architecture T3Code demonstrates.

---

## Architecture Comparison

### T3Code Architecture

```
apps/
├── desktop/          # Electron app
├── mobile/           # iOS/Android (React Native)
├── web/             # React web app
└── server/          # Node.js server (orchestration engine)

packages/
├── client-runtime/  # Shared connection & state management
├── contracts/       # RPC schemas (Effect-based)
├── provider-*/      # Claude, Codex, Cursor, Grok, OpenCode, Antigravity, Pi
├── source-control-*/# GitHub, GitLab, Azure, Bitbucket, etc.
├── ssh/             # SSH tunneling
├── tailscale/       # Tailscale integration
└── shared/          # Utilities
```

### pi-harness-runtime Current State

```
packages/
├── 80+ packages (fragmented, inconsistent)
├── No clear architecture layers
├── No unified RPC contract
├── No multi-client support
├── Telegram notification only
└── No mobile/web app
```

---

## Key T3Code Concepts We Should Adopt

### 1. Event Sourcing + Durable Intent

T3Code's event log is the **source of truth**:
- Commands serialize to event log
- EventSink commits events + projections + outbox effects **atomically**
- EffectWorker performs side effects **after** intent commits
- Command acknowledgement = intent committed, not work finished

**Our current state**: We have `packages/event-store`, `packages/workflow-events` but NO atomic event sourcing pattern.

**Action**: Implement `EventSink` pattern with SQLite transactions.

### 2. Connection Runtime (packages/client-runtime)

T3Code shares connection logic between web, desktop, mobile:
- Supervisor owns transport retry (jittered exponential backoff)
- Registry scopes connections by environment
- State freshness is SEPARATE from transport health
- Subscriptions separate from cache lifetime

**Our current state**: We have `packages/notification` but NO unified connection runtime.

**Action**: Create `packages/connection-runtime` for shared retry/subscription logic.

### 3. RPC Contract (packages/contracts)

T3Code uses **Effect** framework for type-safe RPC:
- All RPC methods declared in one place
- Schema validation with Effect/Schema
- Error types explicitly modeled
- WebSocket + HTTP transports share same contract

**Our current state**: We have scattered API definitions, no unified RPC contract.

**Action**: Create `packages/contracts` with Effect-based schemas.

### 4. Provider Adapter Pattern

T3Code normalizes all providers behind adapters:
- ProviderAdapter interface
- Instance-based routing (one instance per account)
- Process isolation per provider
- Version detection and update handling

**Our current state**: We have `packages/provider-adapter-sdk`, `packages/codex-adapter`, `packages/mcp-adapter` but NO unified provider interface.

**Action**: Standardize provider adapter pattern.

### 5. Permission Modes

T3Code's permission model:
- **Supervised**: Requests approval for commands/edits
- **Auto-accept edits**: Approves edits, questions still need approval
- **Auto**: Uses provider's automatic review
- **Full access**: No approval needed

**Our current state**: We have `packages/agent-policy` for rules, but NO runtime permission modes.

**Action**: Implement permission mode system.

### 6. Remote Access Architecture

T3Code's remote access options:
1. **T3 Connect**: Cloudflare tunnel (like our Telegram webhook)
2. **Direct pairing**: LAN/VPN access
3. **SSH tunneling**: Desktop-managed SSH
4. **Tailscale HTTPS**: Direct Tailscale access

**Our current state**: We have Telegram webhook only, SSH guard but NO T3 Connect equivalent.

**Action**: Implement T3 Connect-style cloud relay.

### 7. Checkpointing + Revert

T3Code uses hidden Git refs for workspace state:
- Captures state without adding commits
- Provider owns conversation rollback
- Revert coordinates workspace + conversation

**Our current state**: We have `packages/checkpoint` but NO hidden-ref pattern.

**Action**: Implement git-based checkpointing with hidden refs.

---

## What T3Code Does NOT Do (We Do Better)

| Feature | T3Code | pi-harness |
|---------|--------|------------|
| **Skills system** | No | Yes (`.pi/skills/`) |
| **Context-mode** | No | Yes (FTS5 knowledge base) |
| **Wiki integration** | No | Yes (packages/wiki) |
| **Durable reviewer** | No | Yes (packages/durable-review) |
| **Project-specific policies** | No | Yes (packages/agent-policy) |
| **Bundle size** | Large (Electron) | Small (Node.js CLI) |

---

## Implementation Roadmap

### Phase 1: Architecture Foundation

1. **Create `packages/contracts`** - RPC schema definitions
2. **Create `packages/connection-runtime`** - Shared retry/subscription
3. **Implement `EventSink` pattern** - Atomic event sourcing

### Phase 2: Provider Normalization

4. **Standardize provider-adapter-sdk** - Unified interface
5. **Add permission modes** - Runtime approval system
6. **Implement checkpoint pattern** - Git hidden refs

### Phase 3: Multi-Client Support

7. **Create `apps/mobile`** - React Native app
8. **Create `apps/web`** - React web app
9. **Implement T3 Connect** - Cloudflare tunnel relay

### Phase 4: Production Hardening

10. **Add Tailscale support** - packages/tailscale
11. **Add SSH tunneling** - Desktop-managed SSH
12. **Add source control integrations** - GitHub, GitLab, etc.

---

## Specific Code Patterns to Borrow

### EventSink Pattern (from T3Code orchestrator)

```typescript
// T3Code: apps/server/src/orchestration-v2/EventSink.ts
// Concept: Commit events, projections, outbox in ONE transaction

async function commitEvent(cmd: Command, event: Event): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Persist event
    await tx.insert(events, { ...event, commandId: cmd.id });
    
    // 2. Update projections
    await updateProjections(tx, event);
    
    // 3. Queue outbox effects
    await tx.insert(outbox, { eventId: event.id, effect: deriveEffect(event) });
    
    // 4. Acknowledge command
    await tx.update(commands, { id: cmd.id }, { status: 'committed' });
  });
}
```

### Connection Supervisor Pattern (from T3Code client-runtime)

```typescript
// T3Code: packages/client-runtime/src/connection/supervisor.ts
// Concept: Jittered exponential backoff, reset after healthy connection

class ConnectionSupervisor {
  private retryDelay = 1000; // Start at 1s
  private maxDelay = 5 * 60 * 1000; // Cap at 5min
  
  async connect(): Promise<void> {
    try {
      await this.transport.open();
      this.retryDelay = 1000; // Reset on success
    } catch (err) {
      const jitter = Math.random() * this.retryDelay;
      await sleep(this.retryDelay + jitter);
      this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
      return this.connect(); // Retry
    }
  }
}
```

### Permission Mode Pattern

```typescript
// T3Code permission modes adapted for pi-harness

type PermissionMode = 'supervised' | 'auto-accept-edits' | 'auto' | 'full-access';

interface ThreadContext {
  mode: PermissionMode;
  projectOverride?: string;
  pendingApprovals: Approval[];
}

async function executeCommand(cmd: Command, ctx: ThreadContext): Promise<void> {
  const requiresApproval = checkRequiresApproval(cmd, ctx.mode);
  
  if (requiresApproval && ctx.mode === 'supervised') {
    ctx.pendingApprovals.push({ command: cmd, threadId: ctx.threadId });
    await notifyApprovalRequest(cmd);
    return; // Wait for approval
  }
  
  // Execute command
  await doExecute(cmd);
}
```

---

## Files to Create/Modify

### New Packages to Create

1. `packages/contracts/` - RPC schemas (Effect-based)
2. `packages/connection-runtime/` - Connection management
3. `packages/event-sink/` - Atomic event sourcing
4. `packages/relay/` - T3 Connect-style cloud relay

### Existing Packages to Refactor

1. `packages/agent-policy/` → Add permission modes
2. `packages/checkpoint/` → Add hidden git refs
3. `packages/provider-adapter-sdk/` → Standardize interface
4. `packages/notification/` → Use connection-runtime

### New Apps to Create

1. `apps/mobile/` - React Native
2. `apps/web/` - React (existing TUI can be web-ified)

---

## Conclusion

T3Code demonstrates **production-ready** architecture for agent harnesses. We can learn from:

1. ✅ Event sourcing with atomic commits
2. ✅ Connection runtime with smart retry
3. ✅ Type-safe RPC contracts
4. ✅ Provider adapter normalization
5. ✅ Permission modes at runtime
6. ✅ Multi-client support (mobile/web/desktop)
7. ✅ Cloud relay (T3 Connect)
8. ✅ Git-based checkpointing

**We should NOT copy**:
- Their Effect-based RPC (we can use simpler Zod/Valibot)
- Their Electron-based desktop app (we're CLI-first)
- Their React Native mobile app (we can start with web)

**Start with**: Phase 1 (Architecture Foundation) - Create contracts + connection-runtime + event-sink.

---

*Analysis date: 2026-10-18*
*Source: https://github.com/pingdotgg/t3code*

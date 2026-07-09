# RFC 0032: Checkpoint Engine

## Summary

An enhanced checkpoint system with incremental snapshots, diff-based storage, and intelligent recovery strategies.

## Motivation

The current checkpoint system (`packages/checkpoint/checkpoint-manager.ts`) only saves full JSON snapshots. For large jobs with many events, this is inefficient. We need:

1. Incremental checkpoints with diff storage
2. Compression for large checkpoints
3. Parallel I/O for faster saves
4. Checksum verification
5. Checkpoint metadata and pruning

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Checkpoint Engine                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Manager    │  │   Storage    │  │   Recovery   │           │
│  │   (API)      │  │   (I/O)      │  │   (Restore) │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Snapshot   │  │    Diff      │  │   Metadata   │           │
│  │   Full       │  │   Incremental│  │   Index      │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Enhanced CheckpointManager

```typescript
interface CheckpointEngineConfig {
  rootDir: string;
  compression: boolean;           // Enable gzip compression
  incremental: boolean;            // Enable incremental diffs
  maxCheckpoints: number;          // Keep last N checkpoints
  autoPrune: boolean;              // Auto-delete old checkpoints
  checksumAlgorithm: 'md5' | 'sha256';
  parallelWrites: boolean;         // Parallel file I/O
}

class CheckpointEngine {
  constructor(config: CheckpointEngineConfig);
  
  // Save operations
  save(jobId: string, state: RuntimeState): Promise<CheckpointMetadata>;
  saveIncremental(jobId: string, delta: StateDelta): Promise<CheckpointMetadata>;
  
  // Load operations
  load(jobId: string): Promise<RuntimeState | null>;
  loadIncremental(jobId: string, version: number): Promise<RuntimeState>;
  
  // Recovery
  recover(jobId: string, strategy: RecoveryStrategy): Promise<RecoveryResult>;
  
  // Management
  prune(jobId: string, keepCount: number): Promise<PruneResult>;
  verify(jobId: string): Promise<VerificationResult>;
  getMetadata(jobId: string): Promise<CheckpointMetadata[]>;
}
```

### 2. State Delta for Incremental Saves

```typescript
interface StateDelta {
  jobId: string;
  baseVersion: number;              // Previous checkpoint version
  targetVersion: number;            // New checkpoint version
  changes: {
    status?: JobStatus;
    tasks?: TaskDelta[];
    context?: ContextDiff;
    errors?: ErrorEntry[];
  };
  timestamp: string;
  checksum: string;
}

interface TaskDelta {
  taskId: string;
  action: 'added' | 'updated' | 'removed';
  before?: Partial<RuntimeTask>;
  after?: Partial<RuntimeTask>;
}
```

### 3. Recovery Strategies

```typescript
type RecoveryStrategy = 
  | 'latest'           // Use most recent checkpoint
  | 'fullest'          // Use checkpoint with most completed tasks
  | 'specific:version' // Use specific version number
  | 'timestamp:ISO'    // Use checkpoint closest to timestamp
  | 'interactive';     // Prompt user to choose

interface RecoveryResult {
  success: boolean;
  recoveredVersion: number;
  lostEvents: number;
  recoveryTimeMs: number;
  warnings?: string[];
}
```

### 4. Checkpoint Metadata

```typescript
interface CheckpointMetadata {
  jobId: string;
  version: number;
  type: 'full' | 'incremental';
  sizeBytes: number;
  compressed: boolean;
  checksum: string;
  taskProgress: {
    total: number;
    completed: number;
    failed: number;
  };
  createdAt: string;
  expiresAt?: string;
}
```

## File Structure

```
packages/checkpoint/
├── src/
│   ├── index.ts                    # Public exports
│   ├── engine.ts                   # CheckpointEngine main class
│   ├── storage.ts                  # File I/O with compression
│   ├── differ.ts                   # Diff calculation
│   ├── recovery.ts                 # Recovery strategies
│   ├── indexer.ts                  # Metadata index
│   ├── types.ts                    # Extended types
│   └── errors.ts                   # Checkpoint errors
├── test/
│   ├── engine.test.ts
│   ├── differ.test.ts
│   └── recovery.test.ts
├── package.json
└── README.md
```

## Usage Examples

### Basic Usage

```typescript
const engine = new CheckpointEngine({
  rootDir: './checkpoints',
  compression: true,
  incremental: true,
  maxCheckpoints: 10,
  autoPrune: true
});

await engine.save('job-123', {
  jobId: 'job-123',
  status: 'running',
  tasks: [...],
  // ...
});
```

### Recovery

```typescript
const result = await engine.recover('job-123', 'latest');
console.log(`Recovered version ${result.recoveredVersion}`);
console.log(`Lost ${result.lostEvents} events`);
```

### Pruning Old Checkpoints

```typescript
await engine.prune('job-123', 5); // Keep last 5 checkpoints
```

## Comparison with Current Implementation

| Feature | Current | RFC-0032 |
| --------- | --------- | ---------- |
| Full snapshots | ✅ | ✅ |
| Incremental diffs | ❌ | ✅ |
| Compression | ❌ | ✅ |
| Checksums | ❌ | ✅ |
| Parallel I/O | ❌ | ✅ |
| Recovery strategies | ❌ | ✅ |
| Auto-pruning | ❌ | ✅ |

## Acceptance Criteria

1. ✅ Incremental checkpoints reduce storage by 60%+ for typical jobs
2. ✅ Compression reduces checkpoint size by 50%+
3. ✅ Recovery can restore job state within 100ms for cached checkpoints
4. ✅ Checksum verification detects corruption
5. ✅ Parallel writes don't block main thread
6. ✅ Auto-pruning maintains disk space limits
7. ✅ Backward compatible with existing checkpoint format

## Dependencies

- `packages/types` - for runtime-types
- `zlib` (Node.js built-in) - for compression
- No new external dependencies

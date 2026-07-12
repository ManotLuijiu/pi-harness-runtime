# @pi/checkpoint

Enhanced checkpoint system with incremental snapshots, diff-based storage, compression, and intelligent recovery strategies.

## Features

- **Incremental Checkpoints** - Only store changes, reducing storage by 60%+
- **Compression** - Optional gzip compression for large checkpoints
- **Checksum Verification** - Detect corruption with SHA-256 checksums
- **Multiple Recovery Strategies** - Latest, fullest, specific version, or by timestamp
- **Auto-Pruning** - Automatically clean up old checkpoints
- **State Diffing** - Efficient incremental updates

## Installation

```bash
npm install @pi/checkpoint
```

## Quick Start

### Basic Usage

```typescript
import { createCheckpointEngine } from "@pi/checkpoint";

const engine = createCheckpointEngine({
  rootDir: "./checkpoints",
  compression: true,
  incremental: true,
  maxCheckpoints: 10,
});

// Save a checkpoint
const state = {
  version: 1,
  jobId: "job-123",
  status: "running",
  requirement: "Build a web app",
  tasks: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

await engine.save("job-123", state);

// Load the latest checkpoint
const recovered = await engine.load("job-123");
console.log(recovered?.status); // "running"
```

### Recovery Strategies

```typescript
import { createCheckpointEngine, RecoveryStrategy } from "@pi/checkpoint";

// Recover using latest checkpoint
const result1 = await engine.recover("job-123", "latest");

// Recover using checkpoint with most completed tasks
const result2 = await engine.recover("job-123", "fullest");

// Recover specific version
const result3 = await engine.recover("job-123", "specific:5");

// Recover closest to a timestamp
const result4 = await engine.recover("job-123", "timestamp:2024-01-15T10:00:00Z");

if (result.success) {
  console.log(`Recovered state at version ${result.recoveredVersion}`);
  console.log(`Recovery took ${result.recoveryTimeMs}ms`);
}
```

### Incremental Checkpoints

```typescript
const engine = createCheckpointEngine({
  rootDir: "./checkpoints",
  incremental: true, // Enable incremental snapshots
  compression: true,
});

// Save creates incremental or full checkpoint automatically
await engine.save("job-123", updatedState);

// Check metadata
const metadata = await engine.getMetadata("job-123");
console.log(metadata.map((m) => ({
  version: m.version,
  type: m.type, // "full" or "incremental"
  sizeBytes: m.sizeBytes,
  taskProgress: m.taskProgress,
})));
```

### Verification & Pruning

```typescript
// Verify a checkpoint
const verified = await engine.verify("job-123", 5);
console.log(`Valid: ${verified.valid}, Checksum: ${verified.checksumMatch}`);

// Prune old checkpoints (keep last 5)
const pruneResult = await engine.prune("job-123", 5);
console.log(`Deleted ${pruneResult.deletedCount} checkpoints`);
console.log(`Freed ${pruneResult.freedBytes} bytes`);
```

## API Reference

### CheckpointEngine

```typescript
const engine = createCheckpointEngine({
  rootDir: string;           // Checkpoint storage directory
  compression?: boolean;     // Enable gzip compression (default: true)
  incremental?: boolean;     // Enable incremental snapshots (default: true)
  maxCheckpoints?: number;  // Max checkpoints to keep (default: 10)
  autoPrune?: boolean;       // Auto-prune on save (default: true)
  checksumAlgorithm?: "md5" | "sha256"; // Checksum algorithm (default: "sha256")
  parallelWrites?: boolean; // Parallel file I/O (default: true)
});
```

### Methods

```typescript
// Save checkpoint (auto-selects full or incremental)
await engine.save(jobId, state): Promise<CheckpointMetadata>;

// Load latest checkpoint
await engine.load(jobId): Promise<RuntimeState | null>;

// Load specific version
await engine.loadState(jobId, version): Promise<RuntimeState | null>;

// Recover using strategy
await engine.recover(jobId, strategy): Promise<RecoveryResult>;

// Verify checkpoint integrity
await engine.verify(jobId, version): Promise<VerificationResult>;

// Prune old checkpoints
await engine.prune(jobId, keepCount): Promise<PruneResult>;

// Get metadata for all checkpoints
await engine.getMetadata(jobId): Promise<CheckpointMetadata[]>;

// Delete all checkpoints
await engine.deleteAll(jobId): Promise<void>;
```

### Recovery Strategies

```typescript
type RecoveryStrategy =
  | "latest"              // Most recent checkpoint
  | "fullest"             // Checkpoint with most completed tasks
  | "specific:number"     // Specific version number
  | "timestamp:ISO"       // Checkpoint closest to timestamp
  | "interactive";        // User selection (returns latest for now)
```

### Checkpoint Metadata

```typescript
interface CheckpointMetadata {
  jobId: string;
  version: number;
  type: "full" | "incremental";
  sizeBytes: number;
  compressed: boolean;
  checksum: string;
  taskProgress: {
    total: number;
    completed: number;
    failed: number;
    running: number;
  };
  createdAt: string;
  baseVersion?: number; // For incremental checkpoints
}
```

## Storage Format

Checkpoints are stored as JSON files:

```
checkpoints/
└── jobs/
    └── job-123/
        ├── index.json              # Checkpoint index
        ├── checkpoint-1.json      # Full checkpoint
        ├── checkpoint-2.delta.json # Incremental checkpoint
        └── checkpoint-3.json      # Full checkpoint
```

## Performance

| Metric | Full Checkpoint | Incremental |
| -------- | ---------------- | ------------- |
| Storage | Baseline | 60-80% reduction |
| Write Speed | Baseline | 30-50% faster |
| Read Speed | Baseline |

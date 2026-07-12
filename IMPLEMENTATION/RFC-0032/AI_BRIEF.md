# RFC-0032 AI Brief: Checkpoint Engine

## Summary

An enhanced checkpoint system with incremental snapshots, diff-based storage, compression, and intelligent recovery strategies.

## Implementation Overview

### Key Classes to Implement

1. **CheckpointEngine** (`engine.ts`)
   - Incremental vs full snapshot handling
   - Recovery strategies (latest, fullest, specific, timestamp)
   - Auto-pruning logic
   - Checksum verification

2. **StorageManager** (`storage.ts`)
   - Parallel I/O for faster saves
   - Gzip compression
   - File rotation and management

3. **DiffCalculator** (`differ.ts`)
   - Calculate state diffs
   - Apply incremental changes
   - Merge delta changes

### Dependencies

- `packages/types` - for runtime-types
- Existing `packages/checkpoint/checkpoint-manager.ts` (enhance, don't replace)

### Files to Create/Modify

- `packages/checkpoint/src/engine.ts` - main engine
- `packages/checkpoint/src/storage.ts` - enhanced storage
- `packages/checkpoint/src/differ.ts` - diff calculations
- `packages/checkpoint/src/recovery.ts` - recovery strategies
- `packages/checkpoint/src/indexer.ts` - metadata index
- `packages/checkpoint/src/types.ts` - extended types

### Backward Compatibility

- Maintain JSON format compatibility
- Detect and load legacy checkpoints
- Export to legacy format if needed

# Honcho E2E Tests

End-to-end tests for Honcho CLI and MCP integration.

## Setup

1. Ensure API key is available:
   - Set `HONCHO_API_KEY` env var, OR
   - Create `~/.pi-harness-runtime/keys/honcho-api-key.txt`

2. Run tests:
   ```bash
   bun test e2e/honcho/
   ```

## Test Files

### `cli.test.ts`
Tests Honcho CLI workspace management:
- List workspaces
- Create workspace
- Create workspace idempotently
- Error handling

### `mcp.test.ts`
Tests Honcho MCP server tools:
- Connection and tool discovery
- Session creation
- Peer creation
- Adding peers to session
- Adding messages
- Chat and search

### `integration.test.ts`
Tests the full workflow:
1. CLI: Create workspace
2. CLI: Verify workspace exists
3. MCP: Create session and peers
4. MCP: Add conversation messages
5. MCP: Retrieve context from memory

## Expected Output

```
bun test e2e/honcho/

✓ cli.test.ts - 4 tests pass
✓ mcp.test.ts - 9 tests pass  
✓ integration.test.ts - 4+ tests pass
```

## Notes

- Tests create temporary workspaces (prefix: `pi-harness-test-`)
- Some test data persists in Honcho for inspection in Explore
- Tests use the actual Honcho API (not mocked)

---
description: Show available slash commands and usage hints
---
# Slash Commands Reference

Type `/` in the editor to see autocomplete.

## Available Commands

| Command | Description |
|---------|-------------|
| `/wr` | Start write-review loop (writer + reviewer) |
| `/writer` | Activate writer agent for a task |
| `/reviewer` | Activate reviewer agent |
| `/tdb` | Connect to TencentDB |
| `/tdb-setup` | Setup TencentDB connection |
| `/cl` | Code review for changelog |

## Write-Review Loop

```
/wr Create a new API endpoint
```

1. Writer implements code
2. Reviewer checks quality
3. Loop until APPROVED
4. Build/commit when ready

## Status File

Check review status:

```
cat .write-review/status.json
```

## More Info

See `prompts/write-review.md` for full documentation.

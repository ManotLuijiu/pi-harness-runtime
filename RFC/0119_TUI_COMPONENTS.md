# RFC-0119 — TUI Components

## Purpose

Terminal UI components for pi-harness-runtime.

## Motivation

CLI tools need TTY components:

- Progress indicators
- Tables and lists
- Status displays
- Interactive prompts

## Components

```typescript
// Progress bar
new ProgressBar({
  total: 100,
  format: "{bar} {percentage}%",
});

// Table
new Table({
  columns: ["Name", "Status", "Duration"],
  rows: data,
});

// Status
new Status({ message: "Processing..." });
```

## Files

See `IMPLEMENTATION/RFC-0119/FILES.md`.

## Acceptance Criteria

- [ ] ProgressBar component
- [ ] Table component
- [ ] Status component
- [ ] Works in terminal

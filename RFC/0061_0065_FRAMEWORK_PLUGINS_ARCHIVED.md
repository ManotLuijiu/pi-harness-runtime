# RFC-0061-0065 — Framework Plugins (ARCHIVED)

## Status: ARCHIVED

Superseded by RFC-0040 (Framework Plugin SDK).

## Archived RFCs

- 0061: FRAPPE_PLUGIN -> RFC-0040
- 0062: NEXTJS_PLUGIN -> RFC-0040
- 0063: REACT_VITE_PLUGIN -> RFC-0040
- 0064: DJANGO_PLUGIN -> RFC-0040
- 0065: LARAVEL_PLUGIN -> RFC-0040

## Resolution

All framework plugins now use the unified interface defined in RFC-0040:

```ts
export interface FrameworkPlugin {
  detect(root: string): Promise<boolean>;
  analyze(root: string): Promise<FrameworkAnalysis>;
}
```

Implementations are in `packages/*-plugin/`.

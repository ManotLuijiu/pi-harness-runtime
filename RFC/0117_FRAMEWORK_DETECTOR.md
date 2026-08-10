# RFC-0117 — Framework Detector

## Purpose

Detect project framework (Frappe, Next.js, Laravel, etc.) from file patterns.

## Motivation

Agents need to know the project framework to:

- Use correct commands (bench vs npm vs artisan)
- Apply framework-specific patterns
- Install correct dependencies

## Supported Frameworks

- Frappe/ERPNext
- Next.js
- Laravel
- Django
- Generic Node.js

## Detection Strategy

```typescript
const DETECTION_PATTERNS = {
  "frappe": ["apps.txt", "sites.txt", "frappe-bench"],
  "nextjs": ["next.config.js", "pages/", "app/"],
  "laravel": ["artisan", "composer.json", "app/Http/"],
  "django": ["manage.py", "settings.py"],
};
```

## Files

See `IMPLEMENTATION/RFC-0117/FILES.md`.

## Acceptance Criteria

- [ ] Detects Frappe/ERPNext projects
- [ ] Detects Next.js projects
- [ ] Returns confidence score
- [ ] Cache detection results

# RFC 0014 - Project Detector and Test Data Engine

## Purpose
Detect project framework and choose suitable dummy data, seed strategy, and E2E approach.

## Motivation
The runtime must work across Frappe/ERPNext, Frappe SPA, Next.js, React/Vite, Django, Laravel, and generic web apps.

## Detection Table
| Project Type | Signals |
|---|---|
| Frappe/ERPNext | `sites/`, `apps/`, `hooks.py`, `doctype/`, `bench` |
| Frappe SPA | `frappe-bench/apps/*/frontend`, `vite.config.*`, Frappe APIs |
| Next.js | `next.config.*`, `app/`, `pages/`, `next` dependency |
| React/Vite | `vite.config.*`, `src/main.tsx`, `index.html` |
| Django | `manage.py`, `settings.py` |
| Laravel | `artisan`, `database/seeders` |
| Generic Web | package.json or unknown web app signals |

## Detection Output
```json
{
  "project_type": "frappe_erpnext",
  "confidence": 0.92,
  "signals": ["frappe-bench/apps", "hooks.py", "doctype folders"],
  "recommended_seed_strategy": "frappe_doc_insert",
  "recommended_e2e_strategy": "bench_site_browser_flow"
}
```

## Acceptance Criteria
- Runtime can detect Frappe/ERPNext, Next.js, and Vite React.
- Runtime can choose a seed strategy.
- Runtime can generate framework-appropriate dummy data plan.
- E2E engine can consume generated test data.

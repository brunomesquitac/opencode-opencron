# src/ directory docs

> [Input]: CLI args, HTTP requests, MCP plugin calls
> [Output]: Task CRUD, Gateway scheduling, Web Dashboard
> [Purpose]: Core source code, contains all business logic

## Subdirectories

| Directory | Responsibility | Entry point |
|-----------|----------------|-------------|
| `cli/` | Commander CLI tool | `cli/index.ts` |
| `core/db/` | Database connection, schema, migrations | `core/db/index.ts` |
| `core/services/` | Business service layer | `core/services/task.service.ts` |
| `gateway/` | Gateway daemon (Worker + Scheduler + Watchdog) | `gateway/index.ts` |
| `web/` | Hono Web Dashboard (SSR) | `web/index.tsx` |
| `worker/` | Worker engine (called by Gateway) | `worker/index.ts` |

## Core files

| File | Purpose |
|------|---------|
| `core/backoff.ts` | Unified exponential backoff |
| `core/services/task-template.service.ts` | Schedule template CRUD + next run calculation |
| `gateway/config.ts` | Gateway config loading |
| `gateway/scheduler/cron-parser.ts` | Cron expression parsing |
| `gateway/scheduler/job-templates.ts` | Template cloning + max_instances check |
| `gateway/watchdog/heartbeat.ts` | Heartbeat timeout detection + kill + retry/dead_letter |
| `gateway/watchdog/cleanup.ts` | Expired record cleanup |

## Path aliases

```json
{
  "@core/*": "src/core/*",
  "@worker/*": "src/worker/*",
  "@gateway/*": "src/gateway/*",
  "@web/*": "src/web/*",
  "@plugin/*": "plugin/*"
}
```

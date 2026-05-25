# plugin/ directory docs

> [Input]: @opencode-ai/plugin SDK, services from src/core/services
> [Output]: OpenCode MCP plugins, registering tool sets for Agent use
> [Purpose]: Plugin layer that exposes task capabilities to OpenCode Agent

## Files

| File | Export | Tool prefix | Tools |
|------|--------|-------------|-------|
| `opencron.ts` | `opencronPlugin` | `opencron_` | 10 (add/next/start/done/fail/status/retry/list/get/schedule) |
| `task.ts` | `TaskPlugin` | `task_` | 7 (add/next/start/done/fail/status/retry) |

## Design

- Registered via `@opencode-ai/plugin` SDK's `tool()`
- Parameter schemas use zod-style definitions
- Default `process.cwd()` as project isolation cwd
- Return values are always JSON strings

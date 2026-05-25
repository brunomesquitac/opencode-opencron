# OpenCron

**Headless task scheduler for OpenCode agents** — schedule, retry, manage batch jobs, and get notified when they finish. Backed by SQLite.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Version](https://img.shields.io/badge/version-0.1.7-blue)

```
OpenCron v0.1.7 — forked from vbgate/opencode-supertask (MIT)
```

## Features

- **CLI** — Full task lifecycle: add, list, get, start, done, fail, cancel, retry, delete
- **Scheduler** — Create tasks automatically from templates (cron, recurring, delayed)
- **Worker** — Execute tasks headlessly via OpenCode SDK with heartbeat and timeout
- **Watchdog** — Detect stale runs, kill orphan processes, retry with exponential backoff
- **Dashboard** — Web UI with 7 pages: Queue, Create, Templates, Runs, Session, Notifications, System
- **Notifications** — 5 channels: Telegram, Discord, Slack, Email, Webhook (per-event or per-task)
- **Plugin** — Expose `opencron_*` tools to any OpenCode agent for self-scheduling
- **Token & Cost Tracking** — Track input/output tokens and USD cost per run
- **i18n** — English and Português (Brasil) built-in
- **Auto Port Fallback** — Gateway auto-scans ports 4680–4779 if the default is busy
- **PM2 Daemon** — Auto-start on boot with crash recovery via `opencron install`

## Architecture

```
┌─ opencode serve :4099 ──────────────────────────┐
│  Headless OpenCode server for background tasks    │
│  Isolated sessions from desktop                   │
└──────────────────┬──────────────────────────────┘
                   │  @opencode-ai/plugin SDK
┌─ OpenCron Gateway :4680+ ──────────────────────┐
│  Scheduler  → scan templates, create tasks       │
│  Worker     → spawn SDK sessions, capture output │
│  Watchdog   → heartbeat, kill stales, retry      │
│  Notify     → Telegram, Discord, Slack, Email... │
│  Dashboard  → Web UI (auto‑refresh, i18n)        │
│  SQLite     → opencron.db (WAL mode)             │
└─────────────────────────────────────────────────┘
```

## Quick Start

```powershell
# Start OpenCode serve
opencode serve --port 4099

# Start OpenCron Gateway
bun run scripts\gateway.mjs

# Open dashboard
opencron ui
```

## CLI Reference

### Task Management

| Command | Description |
|---------|-------------|
| `opencron add -n "Name" -a agent -p "prompt"` | Create a new task (supports `--model`, `--category`, `--importance`, `--urgency`, `--batch`, `--depends`) |
| `opencron list` | List tasks (filters: `--status`, `--batch`, `--category`, `--limit`) |
| `opencron status` | Queue statistics (counts per status) |
| `opencron get --id <id>` | Get task details with run history |
| `opencron next` | Get the next pending task (priority-sorted) |
| `opencron start --id <id>` | Mark a task as running |
| `opencron done --id <id>` | Mark a task as complete |
| `opencron fail --id <id>` | Mark a task as failed |
| `opencron cancel --id <id>` | Cancel a pending/running task |
| `opencron retry --id <id>` | Retry a failed task (`--batch` to retry all failed) |
| `opencron delete --id <id>` | Delete a task |

### Schedule Templates

| Command | Description |
|---------|-------------|
| `opencron template add -n "Daily" -a agent -p "..." --type cron --cron "0 9 * * *"` | Create a cron template |
| `opencron template add -n "Check" -a agent -p "..." --type delayed --delay "30min"` | Create a delayed template |
| `opencron template add -n "Health" -a agent -p "..." --type recurring --interval "2h"` | Create a recurring template |
| `opencron template list` | List all templates |
| `opencron template enable --id <id>` | Enable a template |
| `opencron template disable --id <id>` | Disable a template |
| `opencron template delete --id <id>` | Delete a template |

### Gateway Lifecycle

| Command | Description |
|---------|-------------|
| `opencron gateway` | Start Gateway in foreground |
| `opencron ui` | Open dashboard in browser |
| `opencron config` | Show current configuration |
| `opencron restart` | Restart Gateway via PM2 |
| `opencron install` | Install as PM2 service (auto-start on boot) |
| `opencron uninstall` | Stop and remove PM2 service |
| `opencron upgrade` | Update npm package + restart Gateway |

### Database

| Command | Description |
|---------|-------------|
| `opencron init` | Initialize config + run migrations |
| `opencron migrate` | Run database migrations manually |

## Dashboard (Web UI)

The dashboard runs embedded in the Gateway at `http://localhost:4680`. Features **smart auto-refresh** with configurable interval (5s/10s/30s/60s) — pauses automatically on form pages and open modals.

### Task Queue (`/`)
- Overview cards: Pending / Running / Done / Failed counts (filtered by period)
- Time range filter: 24h / 7d / 30d / All
- Status filter buttons + pagination (50/page)
- Columns: ID, Name, Agent, Status (color badges), Duration, Retries, Tools/Skills, Notification icons
- Actions: Details (JSON modal), Session (conversation view), Clone, Retry, Delete

### Create Task (`/new`)
- Task info: Name, Agent, Model (datalist suggestions), Prompt, Working Directory
- Schedule toggle: Run now or schedule (Cron / Recurring / Delayed)
- Notification overrides: per-task channel selection per event
- Priority: Category, Importance (1–5 stars), Urgency (1–5 stars), Max Retries
- Hover tooltips (ⓘ) explaining every field
- Browse modal: filesystem tree navigation (Windows drives supported)

### Scheduled Tasks (`/templates`)
- Summary cards: Total / Enabled / Disabled
- Table: Name, Type (Cron/Recurring/Delayed), Rule, Status, Last Run, Next Run
- Actions: Details, Edit (full form modal), Trigger (manual run), Enable/Disable, Delete

### Execution Logs (`/runs`)
- Summary cards: Total Cost, Total Tokens, Done, Failed (per period)
- Time range filter + pagination
- Columns: Run ID, Task, Agent, Tools/Skills (tags), Status, Tokens (in→out), Cost, Duration, Heartbeat
- Actions: Details (JSON), Log (raw output), Session (conversation view)

### Session View (`/runs/:id/session`)
Full AI conversation rendered as chat:
- **User messages** — blue border
- **Assistant responses** — green border
- **Tool calls** — purple border (name + arguments)
- **Tool results** — yellow border (scrollable, truncated at 4k chars)
- **Errors** — red border
- Info bar: tokens (in/out), cost, agent, model, tools, skills

### Notifications (`/notifications`)
- Global enable/disable toggle
- Global defaults: which channels fire for each event (Success, Failure, Dead Letter)
- Channel configuration cards:
  - **Telegram** — Bot Token + Chat ID
  - **Discord** — Webhook URL
  - **Slack** — Webhook URL
  - **Email** — SMTP Host, Port, Username, Password, From, To
  - **Webhook** — URL + custom Headers
- Status indicator per channel (green = active, gray = not configured)
- Test button — sends a real test message
- Setup guide (?) — step-by-step instructions per channel
- Environment variable expansion: `${VAR_NAME}` in config fields

### System Status (`/system`)
- Live config editor: Worker (concurrency, poll interval, heartbeat, timeout), Scheduler (enabled, interval, catch-up mode), Watchdog (heartbeat timeout, cleanup interval, retention days)
- Running tasks table with PID, heartbeat, session tracking
- Task statistics
- Language selector: English / Português (Brasil)
- Danger zone: Clear all database data (double confirmation)

## Notifications

| Channel | Transport | Events | Setup |
|---------|-----------|--------|-------|
| **Telegram** | Bot API (MarkdownV2) | done, failed, dead_letter | Bot Token + Chat ID |
| **Discord** | Webhook (rich embeds) | done, failed, dead_letter | Webhook URL |
| **Slack** | Webhook (blocks) | done, failed, dead_letter | Webhook URL |
| **Email** | SMTP (HTML, dark theme) | done, failed, dead_letter | SMTP credentials |
| **Webhook** | HTTP POST (JSON) | done, failed, dead_letter | URL + optional headers |

Notifications are sent automatically by the Worker when a task completes, fails, or exhausts all retries. Each task can override which channels to use.

## Plugin (OpenCode Tools)

When installed as an OpenCode plugin (`@opencode-ai/plugin`), OpenCron exposes these tools to any agent:

| Tool | Description |
|------|-------------|
| `opencron_add` | Create a new task (name, agent, prompt, model, category, importance, urgency, batchId, dependsOn) |
| `opencron_next` | Get the next pending task (priority-sorted, respects dependencies) |
| `opencron_start` | Mark a task as running |
| `opencron_done` | Mark a task as done with result log |
| `opencron_fail` | Mark a task as failed with error log |
| `opencron_status` | Queue statistics |
| `opencron_retry` | Retry a failed task (single or batch) |
| `opencron_list` | List recent tasks (filter by status) |
| `opencron_get` | Get task details by ID |
| `opencron_schedule` | Create schedule templates (cron / recurring / delayed) |
| `opencron_upgrade` | Upgrade the opencron package + restart Gateway |

A hidden agent `opencron-runner` is also available — it auto-fetches tasks from the queue and dispatches them to sub-agents via `opencode run`.

## Configuration

File: `~/.config/opencode/opencron.json` (auto-created on first run).

| Section | Keys | Defaults |
|---------|------|----------|
| `worker` | maxConcurrency, pollIntervalMs, heartbeatIntervalMs, taskTimeoutMs | 2, 1000, 30000, 1800000 |
| `scheduler` | enabled, checkIntervalMs, catchUp (next/all/latest) | true, 1000, next |
| `watchdog` | heartbeatTimeoutMs, cleanupIntervalMs, retentionDays | 600000, 60000, 30 |
| `dashboard` | enabled, port, locale (en/pt-BR) | true, 4680, en |
| `logging` | level, format | info, json |
| `notifications` | enabled, defaults, channels | all disabled |

Use `${VAR_NAME}` syntax in notification config fields to reference environment variables.

## i18n / Localization

OpenCron ships with two built-in locales:

- **English** — default
- **Português (Brasil)** — selectable in System page

All dashboard UI strings are translated: navigation, buttons, status labels, table headers, pagination, tooltips, alerts, forms, modals.

## Database

**Path:** `%USERPROFILE%\.local\share\opencode\opencron.db` (override with `OPENCRON_DB_PATH`)

**Engine:** SQLite (WAL mode, busy timeout 5000ms, auto-migration via Drizzle ORM)

| Table | Description |
|-------|-------------|
| `tasks` | Task queue items (status, agent, model, priority, retries, scheduling, notifications) |
| `task_runs` | Execution records per attempt (log, conversation, tokens, cost, tools, skills, PID) |
| `task_templates` | Recurring schedule definitions (cron, delayed, recurring) |
| `gateway_lock` | Distributed lock preventing duplicate Gateway instances |

## Build from source

```powershell
git clone https://github.com/bmesquitadev/opencode-opencron.git
cd opencode-opencron
bun install
bun run build
```

## License

MIT — based on [opencode-supertask](https://github.com/vbgate/opencode-supertask) (MIT) by vbgate/javazys.

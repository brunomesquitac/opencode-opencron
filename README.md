# OpenCron

**Headless task scheduler for OpenCode agents** — schedule, retry, manage batch jobs with SQLite.

```
OpenCron v0.2 — forked from vbgate/opencode-supertask (MIT)
```

## Architecture

```
┌─ opencode serve :4099 ──────────────────────────┐
│  Headless OpenCode server for background tasks    │
│  Isolated sessions from desktop                   │
└──────────────────┬──────────────────────────────┘
                   │  --attach :4099
┌─ OpenCron Gateway :4680 ───────────────────────┐
│  Scheduler  → scan templates, create tasks       │
│  Worker     → spawn opencode run + capture log   │
│  Watchdog   → heartbeat, retry w/ backoff        │
│  Dashboard  → UI at http://localhost:4680        │
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
# http://localhost:4680
```

## CLI Reference

```powershell
# Task management
opencron add -n "Task" -a "general" -p "prompt" --importance 5
opencron list
opencron status
opencron get --id 1
opencron cancel --id 1
opencron retry --id 1

# Scheduled templates
opencron template add --name "Daily" --agent "explore" --prompt "..." --type cron --cron "0 9 * * *"
opencron template add --name "Check" --agent "explore" --prompt "..." --type delayed --delay "30min"
opencron template add --name "Health" --agent "explore" --prompt "..." --type recurring --interval "2h"
opencron template list

# Gateway lifecycle
opencron gateway       # Start in foreground
opencron restart       # Restart via PM2 (hot reload)
opencron install       # Install as PM2 service (auto-start on boot)
opencron uninstall     # Stop and remove PM2 service
opencron upgrade       # Update npm package + restart
opencron status        # Queue statistics
opencron ui            # Open dashboard in browser
opencron config        # Show current configuration

# Init database
opencron init
```

## Dashboard (Web UI)

The dashboard runs embedded in the Gateway at `http://localhost:4680`.

### Task Queue (`/`)
- Overview cards: Pending / Running / Done / Failed counts
- Filter by status with pagination (50 per page)
- Each task shows: name, agent, status, duration, retries
- Actions: **Details** (JSON modal), **Session** (conversation view), **Retry**, **Delete**
- Success toast when a task is created from the form

### Create Task (`/new`)
Create one-off tasks or scheduled templates directly from the browser:
- **Task info**: Name, Agent, Model, Prompt, Working Directory
- **Schedule**: radio toggle between "Run once now" and "Schedule for later"
  - **Cron**: standard cron expression (e.g. `0 9 * * 1-5`)
  - **Recurring**: fixed interval (minutes / hours / days)
  - **Delayed**: one-time execution after a delay
- **Priority**: Category, Importance (stars 1-5), Urgency (stars 1-5), Max Retries
- All fields have hover tooltips (ⓘ) explaining each concept

### Scheduled Tasks (`/templates`)
- List of all schedule templates with type (Cron / Recurring / Delayed)
- Enable/disable toggle, manual trigger, details modal
- Next run preview for cron expressions

### Execution Logs (`/runs`)
- Run history with task name, agent, status, duration, heartbeat
- Actions: **Details** (JSON), **Log** (raw output), **Session** (conversation view)

### Session View (`/runs/:id/session`)
Full AI conversation formatted as a chat:
- **User messages** (blue border) — the original prompt
- **Assistant responses** (green border) — model output with text
- **Tool calls** (purple border) — tool name + arguments
- **Tool results** (yellow border) — output with scroll
- **Errors** (red border) — model errors highlighted

### System Status (`/system`)
- Live configuration editor (Worker, Scheduler, Watchdog settings)
- Running tasks table with PID, heartbeat, session tracking
- Task statistics and database danger zone (clear all)

## Database

`%USERPROFILE%\.local\share\opencode\opencron.db`

Tables: `tasks`, `task_runs` (with `messages_json` for conversation history), `task_templates`, `gateway_lock`

## Build from source

```powershell
git clone https://github.com/bmesquitadev/opencode-opencron.git
cd opencode-opencron
bun install
bun run build
```

## License

MIT — based on [opencode-supertask](https://github.com/vbgate/opencode-supertask) (MIT) by vbgate/javazys.

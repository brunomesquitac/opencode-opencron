# OpenCron

**Headless task scheduler for OpenCode agents** — schedule, retry, manage batch jobs with SQLite.

```
OpenCron v0.1 — forked from vbgate/opencode-supertask (MIT)
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

# Init database
opencron init
opencron gateway
opencron ui
```

## Database

`%USERPROFILE%\.local\share\opencode\opencron.db`

Tables: `tasks`, `task_runs`, `task_templates`, `gateway_lock`

## Build from source

```powershell
git clone https://github.com/bmesquitadev/opencode-opencron.git
cd opencode-opencron
bun install
bun run build
```

## License

MIT — based on [opencode-supertask](https://github.com/vbgate/opencode-supertask) (MIT) by vbgate/javazys.

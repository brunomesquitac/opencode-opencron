# Patches

Modificações aplicadas ao `opencode-supertask` (vbgate) para criar o OpenCron.

## Patch 1: Gateway Lock Bug

**Arquivo:** `dist/gateway/index.js:19320`

O gateway crashava ao iniciar porque o `acquireLock()` encontrava o próprio PID na tabela `gateway_lock` e interpretava como outra instância.

```diff
- if (now - existing.heartbeat_at < STALE_THRESHOLD_MS) {
+ if (existing.pid !== pid && now - existing.heartbeat_at < STALE_THRESHOLD_MS) {
```

## Patch 2: Path do OpenCode (Windows)

**Arquivo:** `dist/gateway/index.js:18922`

O worker usava `spawn("opencode", ...)` sem caminho absoluto, que falhava no Windows quando o PATH não inclui o npm bin.

```diff
- const child = spawn("opencode", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
+ const child = spawn("%APPDATA%\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
```

## Patch 3: Worker attach ao OpenCode Serve

**Arquivo:** `dist/gateway/index.js:18916`

O worker spawnava `opencode run` sem contexto de sessão, causando "Session not found".

```diff
- const args = ["run", "--agent", "supertask-runner", "--format", "json"];
+ const args = ["run", "--agent", "supertask-runner", "--format", "json", "--attach", "http://localhost:4099"];
```

## Patch 4: Tradução Chinês → Inglês

**Arquivo:** `dist/gateway/index.js`

~70 strings do dashboard e mensagens de erro traduzidas de Mandarim para Inglês:

| Original (ZH) | Traduzido (EN) |
|---|---|
| 任务队列 | Task Queue |
| 定时任务 | Scheduled Tasks |
| 执行日志 | Execution Logs |
| 系统状态 | System Status |
| 详情 | Details |
| 重试 | Retry |
| 删除 | Delete |
| 确定重试任务 #? | Retry task #? |
| 保存配置 | Save Config |
| 清空数据库 | Clear Database |

Também inclui time helpers (秒前 → s ago, 分钟前 → min ago, etc.) e mensagens de erro do worker (执行异常 → execution error).

## Como aplicar

Os arquivos `dist/gateway/index.js` e `dist/worker/index.js` neste repositório já estão com todos os patches aplicados.

Para instalar do zero:

```powershell
# 1. Instalar supertask via bun
bun x opencode-supertask@latest init

# 2. Sobrescrever dist com versão patchada
Copy-Item -Path "dist\gateway\index.js" -Destination "$env:USERPROFILE\.bun\cache\opencode-supertask@latest\node_modules\opencode-supertask\dist\gateway\index.js" -Force
Copy-Item -Path "dist\worker\index.js" -Destination "$env:USERPROFILE\.bun\cache\opencode-supertask@latest\node_modules\opencode-supertask\dist\worker\index.js" -Force

# 3. Iniciar
.\start.bat
```

> **Nota:** O caminho do cache do bun pode variar conforme a versão. O install.ps1 detecta automaticamente.
